const {Adapter, Robot, User, TextMessage, EnterMessage, LeaveMessage, TopicMessage} = require('hubot');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

class AlterdeskAdapter extends Adapter {

    constructor(robot) {
        super(robot);
        this.onConnected = this.onConnected.bind(this);
        this.onData = this.onData.bind(this);
        this.send = this.send.bind(this);
        this.reply = this.reply.bind(this);
    }

    run() {
        let options = {
            token: process.env.HUBOT_ALTERDESK_TOKEN,
            host: process.env.HUBOT_ALTERDESK_HOST || "api.alterdesk.com:443",
            reconnectTry: parseInt(process.env.HUBOT_ALTERDESK_RECONNECT_TRY || 5),
            reconnectWait: parseInt(process.env.HUBOT_ALTERDESK_RECONNECT_WAIT || 5000),
            ssl: parseInt(process.env.HUBOT_ALTERDESK_SSL || 1),
            pmAddPrefix: parseInt(process.env.HUBOT_ALTERDESK_PM_PREFIX || 1),
            typingDelay: parseInt(process.env.HUBOT_ALTERDESK_TYPING_DELAY || 2500),
            typingDelayFactor: process.env.HUBOT_ALTERDESK_TYPING_DELAY_FACTOR,
            typingDelayMin: process.env.HUBOT_ALTERDESK_TYPING_DELAY_MIN,
            typingDelayMax: process.env.HUBOT_ALTERDESK_TYPING_DELAY_MAX,
            autoJoin: parseInt(process.env.HUBOT_ALTERDESK_AUTOJOIN || 1),
            groupchatCacheFile: process.env.HUBOT_ALTERDESK_GROUPCHAT_CACHEFILE || path.join(process.cwd(), 'groupchat_cache.json'),
            exitOnError: parseInt(process.env.HUBOT_ALTERDESK_EXIT_ON_ERROR || 1),
            logErrors: parseInt(process.env.HUBOT_ALTERDESK_LOG_ERRORS || 1),
            errorLogFile: process.env.HUBOT_ALTERDESK_ERROR_LOG_FILE || path.join(process.cwd(), 'hubot_error.log')
        };

        this.robot.logger.info("AlterdeskAdapter::run()", options);

        this.options = options;
        this.connected = false;
        this.reconnectTryCount = 0;

        process.on('uncaughtException', (err) => {
            this.robot.logger.error("AlterdeskAdapter::uncaughtException()");
            if(this.options.logErrors === 1) {
                let errorMessage = "[" + new Date().toISOString() + "]\n";
                if(err.stack) {
                    errorMessage += err.stack + "\n";
                } else {
                    errorMessage += err + "\n";
                }
                fs.appendFileSync(this.options.errorLogFile, errorMessage);
            }
            let exit = this.options.exitOnError === 1;
            if(this.uncaughtExceptionCallback) {
                this.uncaughtExceptionCallback(err, exit);
            } else if(exit) {
                process.exit(1);
            }
        });

        this.groupchat_cache = [];
        if (fs.existsSync(this.options.groupchatCacheFile)) {
            let data = JSON.parse(fs.readFileSync(this.options.groupchatCacheFile));
            this.groupchat_cache = this.groupchat_cache.concat(data);
        }
        this.createClient();
    }

    reconnect() {
        this.reconnectTryCount += 1;
        if (this.reconnectTryCount > this.options.reconnectTry) {
            this.robot.logger.error('AlterdeskAdapter::reconnect() Unable to reconnect to gateway.');
            process.exit(1);
        }

        this.socket.removeEventListener('open', this.onConnected);
        this.socket.removeEventListener('message', this.onData);

        setTimeout(() => {
            this.createClient();
        }, this.options.reconnectWait);
    }

    createClient() {
        this.errorState = false;
        this.socket = new WebSocket(`${this.options.ssl === 1 ? 'wss' : 'ws'}://${this.options.host}/v1/gateway`);
        this.socket.on('open', this.onConnected);
        this.socket.on('message', this.onData);
        this.socket.on('close', (code, message) => {
            this.robot.logger.error(`AlterdeskAdapter socket closed: ${code} ${message}`);
            if(this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }
            if(this.pingTimeout) {
                clearTimeout(this.pingTimeout);
                this.pingTimeout = null;
            }
            if (!this.errorState) {
                this.robot.logger.error("AlterdeskAdapter socket closed, attempting to reconnect");
                this.reconnect();
            }
        });
        this.socket.on('unexpected-response', (req, res) => {
            this.robot.logger.error(`AlterdeskAdapter socket unexpected response: ${res.statusCode}`);
            if (!this.errorState) {
                this.robot.logger.info("AlterdeskAdapter socket unexpected response, attempting to reconnect");
                this.reconnect();
            }
        });
        this.socket.on('error', (error) => {
            this.robot.logger.error(`AlterdeskAdapter socket error: ${error}`);
        });
        this.socket.on('upgrade', (res) => {
            this.robot.logger.info(`AlterdeskAdapter socket upgrade`);
        });
        this.socket.on('pong', () => {
            this.robot.logger.info(`AlterdeskAdapter socket pong`);
            if(this.pingTimeout) {
                clearTimeout(this.pingTimeout);
                this.pingTimeout = null;
            }
        });
    }

    onConnected() {
        this.robot.logger.info("AlterdeskAdapter::onConnected() WebSocket Connected");
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
        this.pingInterval = setInterval(() => {
            this.robot.logger.info(`AlterdeskAdapter socket ping`);
            this.socket.ping();
            this.pingTimeout = setTimeout(() => {
                this.robot.logger.error(`AlterdeskAdapter socket ping timeout`);
                this.socket.close();
            }, 10000);
        }, 30000);
    }

    onData(message) {
        this.robot.logger.debug("AlterdeskAdapter::onData()", message);
        message = JSON.parse(message);
        switch(message.event) {
            case 'authenticated':
                this.readAuthenticated(message.data);
                break;
            case 'typing':
            case 'stop_typing':
                this.readTyping(message.data, message.event);
                break;
            case 'presence_update':
                this.readPresence(message.data);
                break;
            case 'new_conversation':
                this.readConversationEvent(message.data, message.event);
                break;
            case 'conversation_new_message':
                this.readMessageConversation(message.data);
                break;
            case 'conversation_message_liked':
            case 'conversation_message_deleted':
            case 'conversation_verification_accepted':
            case 'conversation_verification_rejected':
                this.readConversationMessageEvent(message.data, message.event);
                break;
            case 'conversation_question_answer':
                this.readConversationQuestionEvent(message.data, message.event);
                break;
            case 'groupchat_new_message':
                this.readMessageGroupchat(message.data);
                break;
            case 'new_groupchat':
            case 'groupchat_removed':
            case 'groupchat_closed':
            case 'groupchat_subscribed':
            case 'groupchat_unsubscribed':
                this.readGroupchatEvent(message.data, message.event);
                break;
            case 'groupchat_message_liked':
            case 'groupchat_message_deleted':
            case 'groupchat_verification_accepted':
            case 'groupchat_verification_rejected':
                this.readGroupchatMessageEvent(message.data, message.event);
                break;
            case 'groupchat_question_answer':
                this.readGroupchatQuestionEvent(message.data, message.event);
                break;
            case 'groupchat_members_added':
            case 'groupchat_members_removed':
                this.readGroupchatMemberEvent(message.data, message.event);
                break;
            case 'error':
                this.robot.logger.error("AlterdeskAdapter::onData() Gateway Error", message);
                if(message.data.code === 304) {
                    if(message.data.error === 'groupchat_is_closed') {
                        this.removeGroupchatFromCache(message.data.groupchat_id);
                    }
                } else if (message.data.code === 403) { //forbidden
                    this.errorState = true;
                } else if(message.data.code === 404) {
                    if(message.data.error === 'groupchat_not_found') {
                        this.removeGroupchatFromCache(message.data.groupchat_id);
                    }
                }
                break;
        }
    }

    readMessageConversation(data) {
        this.robot.logger.debug("AlterdeskAdapter::readMessageConversation() ", data);

        let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id, is_groupchat: false});

        if(user.id === this.robot.user.id) {
            this.robot.logger.debug("AlterdeskAdapter::readConversation() Ignoring message from self");
            return;
        }

        let message = data.body;
        if (
            this.options.pmAddPrefix === 1 &&
            message.slice(0, this.robot.name.length).toLowerCase() !== this.robot.name.toLowerCase()
        ) {
            message = this.robot.name +" "+message;
        }
        this.robot.logger.info(`AlterdeskAdapter::readConversation() Received message: ${message} in room: ${user.room}, from ${user.name}`);
        var textMessage = new TextMessage(user, message, data.message_id);
        textMessage.attachments = data.attachments;
        textMessage.mentions = data.mentions;
        return this.receive(textMessage);
    }

    readMessageGroupchat(data) {
        this.robot.logger.debug("AlterdeskAdapter::readMessageGroupchat()", data);

        let user = this.robot.brain.userForId(data.groupchat_id + data.user_id, {user_id: data.user_id, room: data.groupchat_id, is_groupchat: true});

        if(user.user_id === this.robot.user.id) {
            this.robot.logger.debug("AlterdeskAdapter::readMessageGroupchat() Ignoring message from self");
            return;
        }
        //if no body
        let message = data.body;
        if (typeof message === 'undefined') { //group isn't joined yet, retrieve from api, join groupchat and add to groupchat cache list
            if (this.options.autoJoin === 1) {
                this.joinGroupchat(data.groupchat_id);
                this.addGroupchatToCache(data.groupchat_id);
                this.robot.logger.debug(`AlterdeskAdapter::readMessageGroupchat() Retrieving message ${data.message_id} in group ${data.groupchat_id}`);
                this.robot.http(`${this.options.ssl === 1 ? 'https' : 'http'}://${this.options.host}/v1/groupchats/${data.groupchat_id}/messages/${data.message_id}`).header('Authorization', `Bearer ${this.options.token}`).get()((err, resp, body) => {
                    if (resp.statusCode === 200 || resp.statusCode === 201 || resp.statusCode === 204 || resp.statusCode === 304) {
                        this.robot.logger.debug(`AlterdeskAdapter::readMessageGroupchat() Message: ${resp.statusCode}: ${body}`);
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
                        this.receive(textMsg);
                    } else {
                        this.robot.logger.error(`AlterdeskAdapter::readMessageGroupchat() Message: ${resp.statusCode}: ${body}`);
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
        this.robot.logger.info(`AlterdeskAdapter::readMessageGroupchat() Received message: ${message} in room: ${user.room}, from ${user.name}`);
        var textMessage = new TextMessage(user, message, data.message_id);
        textMessage.attachments = data.attachments;
        textMessage.mentions = data.mentions;
        return this.receive(textMessage);
    }

    readAuthenticated(data) {
        this.robot.user = data.user;
        this.robot.logger.info(`AlterdeskAdapter::readAuthenticated() Authenticated on Gateway as ${data.user.first_name} ${data.user.last_name} from ${data.user.company_name}`);
        this.emit((this.connected?'reconnected':'connected'));
        this.connected = true;
        this.reconnectTryCount = 0;

        setTimeout(() => {
            var user = new User("dummyId");
            this.receive(new TopicMessage(user, "authenticated", data.user));

            for (let i in this.groupchat_cache) {
                this.joinGroupchat(this.groupchat_cache[i]);
            }
        }, 10);
    }

    readPresence(data) {
        this.robot.logger.debug("AlterdeskAdapter::readPresence()", data);

        let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id});
        this.receive(new TopicMessage(user, "presence_update", data.status));
        switch(data.status) {
            case 'busy':
            case 'away':
            case 'online':
                return this.receive(new EnterMessage(user));
            case 'offline':
                return this.receive(new LeaveMessage(user));
        }
    }

    readTyping(data, event) {
        if(data.conversation_id) {
            let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id, is_groupchat: false});
            this.receive(new TopicMessage(user, event, data.conversation_id));
        } else if(data.groupchat_id) {
            let user = this.robot.brain.userForId(data.groupchat_id + data.user_id, {user_id: data.user_id, room: data.groupchat_id, is_groupchat: true});
            this.receive(new TopicMessage(user, event, data.groupchat_id));
        }
    }

    readConversationEvent(data, event) {
        let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id, is_groupchat: false});
        this.receive(new TopicMessage(user, event, data.conversation_id));
    }

    readConversationMessageEvent(data, event) {
        let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id, is_groupchat: false});
        this.receive(new TopicMessage(user, event, data.message_id));
    }

    readConversationQuestionEvent(data, event) {
        let user = this.robot.brain.userForId(data.user_id, {user_id: data.user_id, room: data.user_id, name: data.user_id, is_groupchat: false});
        this.receive(new TopicMessage(user, event, data));
    }

    readGroupchatEvent(data, event) {
        if(event === "new_groupchat") {
            if (this.options.autoJoin === 1) {
                this.joinGroupchat(data.groupchat_id);
                this.addGroupchatToCache(data.groupchat_id);
            }
        } else if(event === "groupchat_removed" || event === "groupchat_closed") {
            this.removeGroupchatFromCache(data.groupchat_id);
        }
        var user = new User("dummyId");
        this.receive(new TopicMessage(user, event, data.groupchat_id));
    }

    readGroupchatMessageEvent(data, event) {
        let user = this.robot.brain.userForId(data.groupchat_id + data.user_id, {user_id: data.user_id, room: data.groupchat_id, is_groupchat: true});
        this.receive(new TopicMessage(user, event, data.message_id));
    }

    readGroupchatQuestionEvent(data, event) {
        let user = this.robot.brain.userForId(data.groupchat_id + data.user_id, {user_id: data.user_id, room: data.groupchat_id, is_groupchat: true});
        this.receive(new TopicMessage(user, event, data));
    }

    readGroupchatMemberEvent(data, event) {
        let user = this.robot.brain.userForId(data.groupchat_id + data.user_id, {user_id: data.user_id, room: data.groupchat_id, is_groupchat: true});
        this.receive(new TopicMessage(user, event, data));
    }

    send(envelope, ...messages) {
        this.robot.logger.debug("AlterdeskAdapter::send()", messages.length);
        for (let i in messages) {
            if (envelope.user.is_groupchat) {
                this.sendGroupchat(envelope, messages[i]);
            } else {
                this.sendConversation(envelope, messages[i]);
            }
        }
    }

    sendGroupchat(envelope, message) {
        this.robot.logger.debug("AlterdeskAdapter::sendGroupchat()", envelope, message);
        let delay = this.calculateTypingDelay(message);
        if (delay > 0) {
            this.socket.send(JSON.stringify({
                event: 'typing',
                data: {
                    groupchat_id: envelope.room
                }
            }));
        }
        setTimeout(() => {
            this.socket.send(JSON.stringify({
                event: "groupchat_new_message",
                data: {
                    body: message,
                    groupchat_id: envelope.room
                }
            }));
        }, delay);
    }

    sendConversation(envelope, message) {
        this.robot.logger.debug("AlterdeskAdapter::sendConversation()", envelope, message);
        let delay = this.calculateTypingDelay(message);
        if (delay > 0) {
            this.socket.send(JSON.stringify({
                event: 'typing',
                data: {
                    conversation_id: envelope.room
                }
            }));
        }
        setTimeout(() => {
            this.socket.send(JSON.stringify({
                event: "conversation_new_message",
                data: {
                    body: message,
                    conversation_id: envelope.room
                }
            }));
        }, delay);
    }

    topic(envelope, ...messages) {
        for (let i in messages) {
            let message = messages[i];
            if(message !== "typing" && message !== "stop_typing") {
                continue;
            }
            if (envelope.user.is_groupchat) {
                this.topicGroupchat(envelope, message);
            } else {
                this.topicConversation(envelope, message);
            }
        }
    }

    topicGroupchat(envelope, message) {
        this.robot.logger.debug("AlterdeskAdapter::topicGroupchat()", envelope, message);
        this.socket.send(JSON.stringify({
            event: message,
            data: {
                groupchat_id: envelope.room
            }
        }));
    }

    topicConversation(envelope, message) {
        this.robot.logger.debug("AlterdeskAdapter::topicConversation()", envelope, message);
        this.socket.send(JSON.stringify({
            event: message,
            data: {
                conversation_id: envelope.room
            }
        }));
    }

    calculateTypingDelay(message) {
        if(this.options.typingDelayFactor && this.options.typingDelayFactor > 0) {
            var timeoutMs = message.length * this.options.typingDelayFactor;
            if(this.options.typingDelayMin && timeoutMs < this.options.typingDelayMin) {
                timeoutMs = this.options.typingDelayMin;
            } else if(this.options.typingDelayMax && timeoutMs > this.options.typingDelayMax) {
                timeoutMs = this.options.typingDelayMax;
            }
            return timeoutMs;
        }
        return this.options.typingDelay;
    }

    joinGroupchat(groupchat_id) {
        this.robot.logger.info(`AlterdeskAdapter::joinGroupchat() Joining groupchat with id '${groupchat_id}'`);
        this.socket.send(JSON.stringify({
            event: 'groupchat_subscribe',
            data: {
                groupchat_id: groupchat_id
            }
        }));
    }

    addGroupchatToCache(groupchat_id) {
        if(this.groupchat_cache.indexOf(groupchat_id) === -1) {
            this.robot.logger.info("AlterdeskAdapter::addGroupchatToCache() Adding groupchat to cache", groupchat_id);
            this.groupchat_cache.push(groupchat_id);
            fs.writeFile(this.options.groupchatCacheFile, JSON.stringify(this.groupchat_cache), (err) => {
                if(err) {
                    this.robot.logger.error("AlterdeskAdapter::addGroupchatToCache() Unable to write groupchat cache file", err);
                }
            });
        }
    }

    removeGroupchatFromCache(groupchat_id) {
        let index = this.groupchat_cache.indexOf(groupchat_id);
        if(index !== -1) {
            this.robot.logger.info("AlterdeskAdapter::removeGroupchatFromCache() Removing groupchat from cache", groupchat_id);
            this.groupchat_cache.splice(index, 1);
            fs.writeFile(this.options.groupchatCacheFile, JSON.stringify(this.groupchat_cache), (err) => {
                if(err) {
                    this.robot.logger.error("AlterdeskAdapter::removeGroupchatFromCache() Unable to write groupchat cache file", err);
                }
            });
        }
    }

    reply(envelope, ...messages) {
        this.send(envelope, ...messages);
    }

    setUncaughtExceptionCallback(callback) {
        this.uncaughtExceptionCallback = callback;
    }
}

exports.use = (robot) => {
    return new AlterdeskAdapter(robot);
};