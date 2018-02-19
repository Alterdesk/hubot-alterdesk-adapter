const {Adapter, Robot, User, TextMessage, EnterMessage, LeaveMessage} = require('hubot');
const WebSocket = require('ws');


class AlterdeskAdapter extends Adapter {

    constructor(...args) {
        super(...args);
        this.onConnected = this.onConnected.bind(this);
        this.onData = this.onData.bind(this);
    }

    run() {
        let options = {
            token: process.env.HUBOT_ALTERDESK_TOKEN,
            host: process.env.HUBOT_ALTERDESK_HOST,
            reconnectTry: process.env.HUBOT_ALTERDESK_RECONNECT_TRY || 5,
            reconnectWait: process.env.HUBOT_ALTERDESK_RECONNECT_WAIT || 5000,
            protocol: process.env.HUBOT_ALTERDESK_PROTOCOL || 'wss',
            pmAddPrefix: process.env.HUBOT_ALTERDESK_PM_PREFIX || 1,
            typingDelay: process.env.HUBOT_ALTERDESK_TYPING_DELAY || 2500
        };

        this.robot.logger.info(options);

        this.options = options;
        this.connected = false;
        this.reconnectTryCount = 0;
        this.createClient();
    }

    reconnect() {
        let options = this.options;

        this.reconnectTryCount += 1;
        if (this.reconnectTryCount > options.reconnectTry) {
            this.robot.logger.error('Unable to reconnect to gateway.');
            process.exit(1);
        }

        this.socket.removeEventListener('open', this.onConnected);
        this.socket.removeEventListener('message', this.onData);

        let self = this;
        setTimeout(() => {
            self.createClient();
        }, options.reconnectWait);
    }

    createClient() {
        this.errorState = false;
        this.socket = new WebSocket(`${this.options.protocol}://${this.options.host}/v1/gateway`);
        this.socket.on('open', this.onConnected);
        this.socket.on('message', this.onData);
        let self = this;
        this.socket.on('close', () => {
            self.robot.logger.info("Connection closed");
            if (!self.errorState) {
                self.robot.logger.info("attempting to reconnect");
                self.reconnect();
            }
        });
        this.socket.on('unexpected-response', (req, res) => {
            self.robot.logger.info(`Unexpected response: ${res.statusCode}`);
            if (!self.errorState) {
                self.robot.logger.info("attempting to reconnect");
                self.reconnect();
            }
        });
        this.socket.on('error', (error) => {
            self.robot.logger.info(`Error: ${error}`);
        });
    }

    onConnected() {
        this.robot.logger.info("WebSocket Connected");
        this.socket.send(JSON.stringify({
            event: 'handshake',
            data: {
                token: this.options.token
            }
        }));
    }

    onData(message) {
        message = JSON.parse(message);
        switch(message.event) {
            case 'authenticated':
                this.robot.user = message.data.user;
                this.robot.logger.info(`Authenticated on Gateway as ${message.data.user.first_name} ${message.data.user.last_name} of ${message.data.user.company_name}`);
                this.emit((this.connected?'reconnected':'connected'));
                this.connected = true;
                this.reconnectTryCount = 0;
                break;
            case 'presence_update':
                this.readPresence(message.data);
                break;
            case 'new_conversation':
                break;
            case 'conversation_new_message':
                this.readMessageConversation(message.data);
                break;
            case 'error':
                if (message.code === 403) { //forbidden
                    this.errorState = true;
                }
                break;
        }
    }

    readMessageConversation(data) {
        this.robot.logger.debug("Message", data);

        let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id});

        if(user.id == this.robot.user.id) {
            this.robot.logger.debug("Ignoring message from self");
            return;
        }

        let message = data.body;
        if (
            this.options.pmAddPrefix === 1 &&
            message.slice(0, this.robot.name.length).toLowerCase() != this.robot.name.toLowerCase()
        ) {
            message = this.robot.name +" "+message;
        }
        this.robot.logger.info(`Received message: ${message} in room: ${user.room}, from ${user.name}`);
        var textMessage = new TextMessage(user, message, data.message_id);
        textMessage.attachments = data.attachments;
        textMessage.mentions = data.mentions;
        return this.receive(textMessage);
    }

    readPresence(data) {
        this.robot.logger.debug("Presence", data);

        let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id});
        switch(data.status) {
            case 'busy':
            case 'away':
            case 'online':
                return this.receive(new EnterMessage(user));
            case 'offline':
                return this.receive(new LeaveMessage(user));
        }
    }

    send(envelope, ...messages) {
        for (let i in messages) {
            if (this.options.typingDelay > 0) {
                this.socket.send(JSON.stringify({
                    event: 'typing',
                    data: {
                        conversation_id: envelope.room
                    }
                }));
            }
            let self = this;
            setTimeout(function() {
                self.socket.send(JSON.stringify({
                    event: 'conversation_new_message',
                    data: {
                        body: messages[i],
                        conversation_id: envelope.room
                    }
                }));
            }, self.options.typingDelay);
        }
    }

    reply(envelope, ...messages) {
        this.send(envelope, ...messages);
    }
}

exports.use = (robot) => {
    return new AlterdeskAdapter(robot);
};