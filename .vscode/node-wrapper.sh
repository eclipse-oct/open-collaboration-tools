#!/bin/bash
# Node.js wrapper for VS Code debugging
# This script ensures Node.js is available regardless of version manager (nvm, volta, etc.)

# Try to source nvm if it exists
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
fi

# Try to source volta if it exists
if [ -d "$HOME/.volta" ]; then
    export VOLTA_HOME="$HOME/.volta"
    export PATH="$VOLTA_HOME/bin:$PATH"
fi

# Execute node with all arguments passed to this script
exec node "$@"

