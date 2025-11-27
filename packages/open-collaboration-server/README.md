# Open Collaboration Server

Open Collaboration Tools is a collection of open source tools, libraries and extensions for live-sharing of IDE contents, designed to boost remote teamwork with open technologies. For more information about this project, please [read the announcement](https://www.typefox.io/blog/open-collaboration-tools-announcement/).

This package is the server implementation for Open Collaboration Tools. All participants of a collaboration session must connect to the same server.

You can run this package directly or use the public container image [oct-server](https://github.com/eclipse-oct/open-collaboration-tools/pkgs/container/open-collaboration-tools%2Foct-server). If you'd like to customize the server, use this package as a TypeScript library and build your own application.

## The Public Instance

A public instance of this server is available at `https://api.open-collab.tools/`, which is operated by [TypeFox](https://www.typefox.io/). TypeFox offers this service with the intent to demonstrate the capabilities of the project and to support open source communities with it. However, we recommend all companies who wish to adopt this technology to deploy their own instance of it, secured with their existing access restrictions.

Usage of the public instance is bound to its [Terms of Use](https://www.open-collab.tools/tos/). Please read them carefully and use our [Discussions](https://github.com/eclipse-oct/open-collaboration-tools/discussions) for any questions.

## Configuration

### General environment variables

| Variable | Description |
|--------------------|---|
| OCT_SERVER_OWNER          | Name of the server owner. E.g. the name of the company that hosts the server |
| OCT_JWT_PRIVATE_KEY       | The private key for encoding the JWT's used for authenticating users  |
| OCT_LOGIN_PAGE_URL        | Url of the login page. Defaults to /login.html?token={token}  |
| OCT_LOGIN_SUCCESS_URL     | Url of the login success page. Defaults a simple "Login Successful. You can close this page" text  |
| OCT_ACTIVATE_SIMPLE_LOGIN | Activates the simple login handler to alow unverified authentication just with username and optionally email |
| OCT_REDIRECT_URL_WHITELIST | A comma seperated list to allow usage of the specified URLs with the `redirect` query parameter when authenticating with a provider which redirects back after success. The query of a URL is ignored when validating against this list   |
| OCT_BASE_URL              | Base URL of the server is reachable under. Used for oauth redirects |
| OCT_CORS_ALLOWED_ORIGINS | `,` seperated list to configure the allowed origins for CORS. This will be evaluated based on the origin header of the request. if there is no match, fail the request. if not set all origin will be allowed |

### Authentication provider configuration variables

currently supported providers are:

- Google
- Github
- Authentic
- Keycloak
- generic oauth (uses code flow) (can be configured by not giving a provider name. e.g OCT_OAUTH_CLIENTID)

| Variable | Description | Supported Providers |
|--------------------|---|------|
| OCT_OAUTH_{Provider Name}_CLIENTID | Sets the client id for the specified OAuth provider | all |
| OCT_OAUTH_{Provider Name}_CLIENTSECRET | Sets the client secret for the specified OAuth provider | all |
| OCT_OAUTH_{Provider Name}_URL | Sets the host URL for a custom OAuth provider | authentic, keycloak, generic |
| OCT_OAUTH_{Provider Name}_USERNAMECLAIM | Sets the preferred username claim for an OAuth provider; defaults to `preferred_username` | authentic, keycloak, generic |
| OCT_OAUTH_{Provider Name}_EMAILCLAIM | Sets the email claim for an OAuth provider; defaults to `email` | generic |
| OCT_OAUTH_{Provider Name}_CLIENTLABEL | Sets a custom label for the specified OAuth provider | authentic, keycloak, generic |
| OCT_OAUTH_{Provider Name}_REALM | Sets the keycloak realm to use | keycloak |
| OCT_OAUTH_USERINFO_URL | user info url if using oidc. If empty access token will be used for claims | generic |
| OCT_OAUTH_TOKEN_URL | token url for code flow to retrieve the access token | generic |
