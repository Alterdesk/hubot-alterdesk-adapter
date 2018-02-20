const {Adapter, Robot, User, TextMessage, EnterMessage, LeaveMessage} = require('hubot');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
            ssl: process.env.HUBOT_ALTERDESK_SSL || 1,
            pmAddPrefix: process.env.HUBOT_ALTERDESK_PM_PREFIX || 1,
            typingDelay: process.env.HUBOT_ALTERDESK_TYPING_DELAY || 2500,
            autoJoin: process.env.HUBOT_ALTERDESK_AUTOJOIN || 1,
            groupchatCacheFile: process.env.HUBOT_ALTERDESK_GROUPCHAT_CACHEFILE || path.join(process.cwd(), 'groupchat_cache.json')
        };

        this.robot.logger.info(options);

        this.options = options;
        this.connected = false;
        this.reconnectTryCount = 0;

        this.groupchat_cache = [];
        if (fs.existsSync(this.options.groupchatCacheFile)) {
            let data = JSON.parse(fs.readFileSync(this.options.groupchatCacheFile));
            this.groupchat_cache = this.groupchat_cache.concat(data);
        }
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
        this.socket = new WebSocket(`${this.options.ssl===1?'wss':'ws'}://${this.options.host}/v1/gateway`);
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
                token: this.options.token,
                properties: {
                    os: os.platform(),
                    browser: "Hubot",
                    device: "Hubot Alterdesk Adapter",
                    version: this.robot.version
                }
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

                for (var i in this.groupchat_cache) {
                    this.joinGroupchat(this.groupchat_cache[i]);
                }
                break;
            case 'presence_update':
                this.readPresence(message.data);
                break;
            case 'new_conversation':
                break;
            case 'conversation_new_message':
                this.readMessageConversation(message.data);
                break;
            case 'groupchat_new_message':
                this.readMessageGroupchat(message.data);
                break;
            case 'new_groupchat':
                //add groupchat id to cache? if auto join is active
                if (this.options.autoJoin === 1) {
                    this.joinGroupchat(message.data.groupchat_id);
                    this.addGroupchatToCache(message.data.groupchat_id);
                }
                break;
            case 'error':
                this.robot.logger.error("Gateway Error", message);
                if (message.code === 403) { //forbidden
                    this.errorState = true;
                }
                break;
        }
    }

    readMessageConversation(data) {
        this.robot.logger.debug("Conversation Message", data);

        let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id, is_groupchat: false});

        if(user.id === this.robot.user.id) {
            this.robot.logger.debug("Ignoring message from self");
            return;
        }

        let message = data.body;
        if (
            this.options.pmAddPrefix === 1 &&
            message.slice(0, this.robot.name.length).toLowerCase() !== this.robot.name.toLowerCase()
        ) {
            message = this.robot.name +" "+message;
        }
        this.robot.logger.info(`Received message: ${message} in room: ${user.room}, from ${user.name}`);
        var textMessage = new TextMessage(user, message, data.message_id);
        textMessage.attachments = data.attachments;
        textMessage.mentions = data.mentions;
        return this.receive(textMessage);
    }

    readMessageGroupchat(data) {
        this.robot.logger.debug("Groupchat Message", data);

        let user = this.robot.brain.userForId(data.groupchat_id + data.user_id, {user_id: data.user_id, room: data.groupchat_id, is_groupchat: true});

        if(user.user_id === this.robot.user.id) {
            this.robot.logger.debug("Ignoring message from self");
            return;
        }
        //if no body
        let message = data.body;
        if (typeof message === 'undefined') { //group isn't joined yet, retrieve from api, join groupchat and add to groupchat cache list
            let self = this;
            if (this.options.autoJoin === 1) {
                this.joinGroupchat(data.groupchat_id);
                this.addGroupchatToCache(data.groupchat_id);
                this.robot.logger.debug(`Retrieving message ${data.message_id} in group ${data.groupchat_id}`);
                this.robot.http(`${this.options.ssl === 1 ? 'https' : 'http'}://${this.options.host}/v1/groupchats/${data.groupchat_id}/messages/${data.message_id}`).header('Authorization', `Bearer ${this.options.token}`).get()((err, resp, body) => {
                    if (resp.statusCode === 200 || resp.statusCode === 201 || resp.statusCode === 204 || resp.statusCode === 304) {
                        this.robot.logger.debug(`Message: ${resp.statusCode}: ${body}`);
                        var msgObject = JSON.parse(body);
                        message = msgObject.body;
                        if (
                            this.options.pmAddPrefix === 1 &&
                            message.slice(0, this.robot.name.length).toLowerCase() !== this.robot.name.toLowerCase()
                        ) {
                            message = this.robot.name + " " + message;
                        }
                        let textMsg = new TextMessage(user, message, data.message_id);
                        textMsg.attachments = data.attachments;
                        textMsg.mentions = data.mentions;
                        self.receive(textMsg);
                    } else {
                        this.robot.logger.error(`Message: ${resp.statusCode}: ${body}`);
                    }
                });
            }
            return;
        }

        if (
            this.options.pmAddPrefix === 1 &&
            message.slice(0, this.robot.name.length).toLowerCase() !== this.robot.name.toLowerCase()
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
            if (envelope.user.is_groupchat) {
                this.sendGroupchat(envelope, messages[i]);
            } else {
                this.sendConversation(envelope, messages[i]);
            }
        }
    }

    sendGroupchat(envelope, message) {
        if (this.options.typingDelay > 0) {
            this.socket.send(JSON.stringify({
                event: 'typing',
                data: {
                    groupchat_id: envelope.room
                }
            }));
        }
        let self = this;
        setTimeout(function() {
            self.socket.send(JSON.stringify({
                event: "groupchat_new_message",
                data: {
                    body: message,
                    groupchat_id: envelope.room
                }
            }));
        }, self.options.typingDelay);
    }

    sendConversation(envelope, message) {
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
                event: "conversation_new_message",
                data: {
                    body: message,
                    conversation_id: envelope.room
                }
            }));
        }, self.options.typingDelay);
    }

    joinGroupchat(groupchat_id) {
        this.robot.logger.info(`Joining groupchat with id '${groupchat_id}'`);
        this.socket.send(JSON.stringify({
            event: 'groupchat_open',
            data: {
                groupchat_id: groupchat_id
            }
        }));
    }

    addGroupchatToCache(groupchat_id) {
        this.groupchat_cache.push(groupchat_id);
        fs.writeFile(this.options.groupchatCacheFile, JSON.stringify(this.groupchat_cache));
    }

    reply(envelope, ...messages) {
        this.send(envelope, ...messages);
    }
}

exports.use = (robot) => {
    return new AlterdeskAdapter(robot);
};