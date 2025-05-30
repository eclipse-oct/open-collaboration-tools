# Open Collaboration Service Process

Open Collaboration Tools is a collection of open source tools, libraries and extensions for live-sharing of IDE contents, designed to boost remote teamwork with open technologies. For more information about this project, please [read the announcement](https://www.typefox.io/blog/open-collaboration-tools-announcement/).

This package is a standalone Node.js application, which helps to simplify integration of OCT with non-TypeScript environments, by providing a stdin/stdout based [JSON-RPC](https://www.jsonrpc.org/) API.

It takes over encryption, session lifecycle management, and includes Yjs integration for collision-free real-time editing of documents,
so client applications do not need to implement these complex features themselves.

## Usage

### Starting the Service Process

Start the process by either using [Node.js](https://nodejs.org) to call `process.js` or use a prebuilt executable:

```sh
node ./lib/process.js --server-address http://localhost:8100 --auth-token <your-auth-token>
```

- `--server-address` (**required**): The address of the collaboration server to connect to (e.g., `https://api.open-collab.tools`).
- `--auth-token` (**optional**): The authentication token to use for the session, if saved by the application from a previous login

### Communication Protocol

All communication happens via JSON-RPC 2.0 messages over stdin/stdout.
See [messages.ts](src/messages.ts) for service process specific awarness or lifecycle messages. Other messages follow the open-collaboration-protocol.

For specific examples see `service.process.test.ts` or the [IntellIj integration](https://github.com/eclipse-oct/oct-intellij)

### Sending and Receiving Binary Data

- For efficient document and file transfer, binary data is supported.
- Use the `BinaryData` type for parameters or results that contain binary content.
- Binary data is encoded as base64-encoded [MessagePack](https://msgpack.org/) in the `data` field of a `BinaryData` object.

#### Example: Sending Binary Data

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "awareness/getDocumentContent",
  "params": ["path/to/file"]
}
```

The response will be:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "type": "binaryData",
    "data": "<base64-encoded-messagepack>"
  }
}
```

Or sending Binary Data as a Parameter:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "fileSystem/writeFile",
  "params": [
    {
      "type": "binaryData",
      "data": "<base64-encoded-messagepack>"
    }
  ]
}
```
