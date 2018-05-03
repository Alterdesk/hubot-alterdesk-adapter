# Hubot Alterdesk Adapter

Adapter to connect a [Hubot](https://hubot.github.com/) instance to the 
[Alterdesk Gateway API](https://api.alterdesk.com/documentation/gateway)

Dependencies
* [ws](https://github.com/websockets/ws)

## Usage
To use the adapter, set at least the OAuth 2.0 token for Alterdesk API as an environment variable in your Hubot startup script.

Bash script, usually located at *hubot/bin/hubot*
```sh
#!/bin/sh

set -e

export PATH="node_modules:node_modules/.bin:node_modules/hubot/node_modules/.bin:$PATH"

export HUBOT_ALTERDESK_TOKEN=<ALTERDESK_API_TOKEN>

exec node_modules/.bin/hubot --name "hubot" --adapter "alterdesk" "$@"

```

Batch script, usually located at *hubot/bin/hubot.cmd*
```batch
@echo off

SETLOCAL
SET PATH=node_modules\.bin;node_modules\hubot\node_modules\.bin;%PATH%

SET HUBOT_ALTERDESK_TOKEN=<ALTERDESK_API_TOKEN>

node_modules\.bin\hubot.cmd --name "alterdeskbot" --adapter "alterdesk" %*
```

## Environment variables
Using enviroment variables various settings can be changed, only the API token variable that is mandatory.

### Connection settings
HUBOT_ALTERDESK_TOKEN
* OAuth 2.0 token for the Alterdesk API

HUBOT_ALTERDESK_HOST
* Host and port of the Alterdesk API *(default: api.alterdesk.com:443)*

HUBOT_ALTERDESK_RECONNECT_TRY
* Amount of retries to reconnect to Alterdesk *(default: 5)*

HUBOT_ALTERDESK_RECONNECT_WAIT
* Milliseconds to wait for a reconnect attempt *(default: 5000)*

HUBOT_ALTERDESK_SSL || 1,
* Use SSL to connect to Alterdesk. *(0 = off, 1 = on, default: 1)*

### Message settings
HUBOT_ALTERDESK_PM_PREFIX
* Message from Alterdesk always have the robot name as a prefix(to trigger Hubot). *(0 = off, 1 = on, default: 1)*

HUBOT_ALTERDESK_TYPING_DELAY
* Milliseconds to show Hubot as "Typing..." before sending message to Alterdesk *(default: 2500)*

### Group chat settings
HUBOT_ALTERDESK_AUTOJOIN
* Should automatically join group chats. *(0 = off, 1 = on, default: 1)*

HUBOT_ALTERDESK_GROUPCHAT_CACHEFILE
* Group chat join cache file location *(default: groupchat_cache.json)*


## Behaviour

### Authentication
When Hubot is authenticated on Alterdesk, an [authentication event](#Authentication Events) is received as a 
TopicMessage. The chat ids that are set in the cache file will be joined when auto join is enabled. When auto join is 
disabled, the cache file can be used to limit Hubot to certain group chats.

### One to one chat
Sending and receiving messages in a chat with a single user behave like normal Hubot chats.

### Group chat
To receive messages in a group chat, the adapter needs to been joined(subscribed) in the chat. When the adapter is not 
joined in the group, truncated messages will be received with a slight delay. If auto join is enabled, and the adapter 
receives a group message for a chat that has not been joined, the adapter will join the chat and than retrieve the full 
message and passes it to Hubot. If auto join is disabled the truncated message will be discarded and Hubot will not 
receive a message.
Messages in a group, the user.id contains both the user id and the group id to separate the chats artificially within 
the adapter. This enables users to chat in a one-to-one chat and a group chat at the same time without mixing the chats 
up. To retrieve the user id from a group chat message, the user id is set in the parameter user.user_id.

### Attachments
Attachments that are received are added to a TextMessage in the parameter attachments.

### User mentions
If a user tags a chat member, the mention is added to a TextMessage in the parameter mentions.
The "@All members" mention is not included

## Events
When an messenger event is received, it is sent to the Hubot instance by a TopicMessage.

### Authentication Events
* *authenticated*

TopicMessage:
* *user*: Dummy Hubot user data
* *text*: "authenticated"
* *id*: Alterdesk user data

### User composing events
* *typing* 
* *stop_typing*

TopicMessage:
* *user*: Hubot user data
* *text*: "EVENT_NAME"
* *id*: "CHAT_ID"

### User presence events
* *presence_update*

TopicMessage:
* *user*: Hubot user data
* *text*: "presence_update"
* *id*: "STATUS"

For the status *online*, *away* and *busy* an EnterMessage is received. For the status *offline* a LeaveMessage is 
received.

### Chat events
* *new_conversation*
* *new_groupchat*
* *groupchat_removed*
* *groupchat_closed*
* *groupchat_subscribed*
* *groupchat_unsubscribed*

TopicMessage:
* *user*: Dummy Hubot user data
* *text*: "EVENT_NAME"
* *id*: "CHAT_ID"

### Message events
* *conversation_message_liked*
* *conversation_message_deleted*
* *groupchat_message_liked*
* *groupchat_message_deleted*

TopicMessage:
* *user*: Hubot user data
* *text*: "EVENT_NAME"
* *id*: "MESSAGE_ID"

### Groupchat member events
* *groupchat_members_added* 
* *groupchat_members_removed*

TopicMessage:
* *user*: Hubot user data
* *text*: "EVENT_NAME"
* *id*: Alterdesk member added/removed data

## Example code
Handling messages in the receiver function of the Hubot instance
```javascript
if(message instanceof TextMessage) {
    
    var userId;
    var userInGroup = message.user.user_id != null;
    if(userInGroup)
        userId = message.user.user_id;
    } else {
        userId = message.user.id;
    }
    
    if(userInGroup) {
        console.log("Received group message from user " + userId + " in chat " + message.room);
    } else {
        console.log("Received 1-to-1 message from user " + userId + " in chat " + message.room);
    }
    
    // Check and parse attachments
    var attachments = message.attachments;
    if(attachments != null) {
        for(var i in attachments) {
            var attachment = attachments[i];
            var attachmentId = attachment["id"]; // Attachment id
            var filename = attachment["name"];   // File name
            var mime = attachment["mime"];       // MIME type
            var size = attachment["size"];       // Size in bytes
        }
    }
    
    // Check and parse mentions
    var mentions = message.mentions;
    if(mentions != null) {
        for(var i in mentions) {
            var mention = mention[i];
            var mentionId = mention["id"];             // User id
            var userType = mention["type"];            // User type
            var firstName = mention["first_name"];     // First name
            var lastName = mention["last_name"];       // Last name
            var companyName = mention["company_name"]; // Company name
            var companyId = mention["company_id"];     // Company id
            var position = mention["position"];        // Job title
            var avatar = mention["avatar"];            // URL to user avatar image
            var active = mention["active"];            // User active
        }
    }
    
} else if(message instanceof EnterMessage) {
    console.log("User is active on messenger: " + message.user.id);
} else if(message instanceof LeaveMessage) {
    console.log("User is inactive on messenger: " + message.user.id);
} else if(message instanceof TopicMessage) {
    console.log("Event: " + message.text);
}
```