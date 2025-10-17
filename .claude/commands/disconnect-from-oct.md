---
description: Disconnect from the current OCT collaboration session
---

When disconnecting from an OCT session, follow these steps:

1. **Stop Background Monitoring Agent** (if running)
    - If a background oct-collab-agent Task was launched during connection, it should be stopped
    - Note: The agent will automatically stop when disconnection occurs since oct_wait_for_trigger will fail

2. **Disconnect from OCT Session**
    - Use the `oct_disconnect` tool to disconnect from the OCT session
    - This will cleanup all resources, stop animations, and close the connection

3. **Confirm to User**
    - Confirm successful disconnection to the user
    - Inform them that the monitoring agent has been stopped (if applicable)
    - Let them know they can reconnect using `/connect-to-oct <room-id>`
