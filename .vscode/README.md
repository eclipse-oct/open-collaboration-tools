# VS Code Debug Configuration

## Node.js Version Manager Support

This project uses a Node.js wrapper script (`node-wrapper.sh`) to ensure debugging works regardless of how Node.js is installed on your system.

### Supported Node Version Managers

-   **nvm** (Node Version Manager)
-   **volta**
-   System-installed Node.js

### How It Works

The `node-wrapper.sh` script automatically detects and loads your Node version manager before running Node.js. This ensures VS Code can find Node.js even when launched from the Dock/Finder on macOS or Start Menu on Windows.

### Troubleshooting

If you're still having issues with Node.js not being found:

1. **Ensure Node.js is installed**: Run `node --version` in your terminal
2. **Check the wrapper is executable**: It should be executable by default, but you can verify with:
    ```bash
    chmod +x .vscode/node-wrapper.sh
    ```
3. **Alternative: Launch VS Code from terminal**:
    ```bash
    code .
    ```
    This ensures VS Code inherits your shell's PATH environment.

### For Other Version Managers

If you use a different Node version manager (e.g., `fnm`, `asdf`), you can modify `node-wrapper.sh` to add support for it.
