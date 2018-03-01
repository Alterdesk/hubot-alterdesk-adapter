# Hubot Alterdesk Adapter

Adapter to connect a Hubot instance to the Alterdesk Gateway API

To use the adapter, set at least the API token for Alterdesk as an environment variable in your hubot startup script.
```sh
#!/bin/sh

set -e

export PATH="node_modules:node_modules/.bin:node_modules/hubot/node_modules/.bin:$PATH"

export HUBOT_ALTERDESK_TOKEN=<ALTERDESK_API_TOKEN>

exec node_modules/.bin/hubot --name "hubot" --adapter "alterdesk" "$@"

```