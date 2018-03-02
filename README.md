# Hubot Alterdesk Adapter

Adapter to connect a [Hubot](https://hubot.github.com/) instance to the [Alterdesk Gateway API](https://api.alterdesk.com/documentation/gateway)

## Usage
To use the adapter, set at least the API token for Alterdesk as an environment variable in your hubot startup script.
```sh
#!/bin/sh

set -e

export PATH="node_modules:node_modules/.bin:node_modules/hubot/node_modules/.bin:$PATH"

export HUBOT_ALTERDESK_TOKEN=<ALTERDESK_API_TOKEN>

exec node_modules/.bin/hubot --name "hubot" --adapter "alterdesk" "$@"

```


## Environment variables

### Connection settings
HUBOT_ALTERDESK_TOKEN
* Token for the Alterdesk API

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
When Hubot is authenticated on Alterdesk, the chats will be joined that are set in the cache file.
When auto join is disabled, the cache file can be used to limit Hubot to certain group chats.

### One to one chat
Sending and receiving messages in a chat with a single user behave like normal Hubot chats.

### Group chat
When a message is received in a group, the user.id contains both the user id and the group id to separate the chats artificially.
To retrieve the user id from a group chat message, the user id is set in the parameter user.user_id.

### Presence
If a user changes its presence, an EnterMessage or LeaveMessage is passed to Hubot.

EnterMessage:
* Online
* Away
* Busy

LeaveMessage:
* Offline

### Attachments
Attachments that are received are added to a TextMessage in the parameter attachments.

### User mentions
If a user tags a chat member, the mention is added to a TextMessage in the parameter mentions.
The "@All members" mention is not included