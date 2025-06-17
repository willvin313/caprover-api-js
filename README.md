# CapRover API for Node.js

![npm version](https://img.shields.io/npm/v/caprover-api-js.svg)
![build status](https://img.shields.io/github/actions/workflow/status/willvin313/caprover-api-js/npm-publish.yml?branch=main)
![license](https://img.shields.io/npm/l/caprover-api-js.svg)

An **UNOFFICIAL** TypeScript-based, promise-driven Node.js library for interacting with the CapRover API.

This library is a port of the excellent Python library [caprover-api](https://github.com/ak4zh/Caprover-API) by *ak4zh* and aims to provide similar functionality for the JavaScript ecosystem.

## Features

- Fully typed with TypeScript for a great developer experience
- Modern async/await syntax
- Manages the authentication token automatically
- Provides methods for all common CapRover operations:
  - App management (list, get, create, update, delete)
  - Deploying from an image, Dockerfile, or one-click app repository
  - Managing custom domains and SSL certificates
  - Creating and downloading server backups
- Includes a built-in retry mechanism for network-related errors

## Installation

You can install the library using npm or yarn.

```bash
npm install caprover-api-js
```

```bash
yarn add caprover-api-js
```

## Usage

All methods are asynchronous and return a Promise. It is recommended to use the async/await syntax inside a try/catch block.

### Import

```typescript
import { CaproverAPI } from 'caprover-api-js';
```

 OR

```typescript
const { CaproverAPI } = require('caprover-api-js');
```

### Initialization

Unlike the Python version, the constructor is private. You must use the static `CaproverAPI.create()` method to initialize the client. This method handles the asynchronous login process and returns a fully authenticated instance.

```typescript
async function main() {
    try {
        console.log('Connecting to CapRover...');
        const api = await CaproverAPI.create({
            dashboardUrl: 'https://captain.your-domain.com',
            password: 'your-super-secret-password',
        });
        console.log('Successfully connected!');

        // You can now use the 'api' object to interact with CapRover
    } catch (error) {
        console.error('Failed to connect or execute command:', (error as Error).message);
    }
}

main();
```

### List Apps

Fetches all application definitions from your CapRover instance.

```typescript
// (inside an async function after initialization)

const appListResponse = await api.listApps();
const apps = appListResponse.data.appDefinitions;

console.log('Available applications:');
apps.forEach(app => {
    console.log(`- ${app.appName} (Instances: ${app.instanceCount})`);
});
```

### Create & Deploy a New App (from Docker Image)

This example shows a full lifecycle: create an app, update its configuration, and deploy Nginx to it.

```typescript
// (inside an async function after initialization)
const newAppName = 'my-nginx-app';

try {
    console.log(`Creating new app: ${newAppName}`);
    await api.createApp(newAppName, false); // hasPersistentData = false

    console.log('Updating app environment variables...');
    await api.updateApp(newAppName, {
        envVars: [{ key: 'NGINX_VERSION', value: 'latest' }]
    });

    console.log(`Deploying nginx image to ${newAppName}...`);
    await api.deployApp(newAppName, { imageName: 'nginx:latest' });

    console.log('Deployment successful!');
} catch (error) {
    console.error(`Failed to deploy ${newAppName}:`, (error as Error).message);
}
```

### Deploy a One-Click App

You can easily deploy any app from the official one-click-apps repository.

```typescript
// (inside an async function after initialization)
const appName = 'my-portainer';

try {
    console.log(`Deploying Portainer from one-click repository...`);
    await api.deployOneClickApp(
        'portainer', // The name of the app in the repository
        appName,     // The name you want to give the app on your server
        {}           // An object for any required app variables (Portainer needs none)
    );
    console.log('Portainer deployed successfully!');
} catch (error) {
    console.error(`Failed to deploy Portainer:`, (error as Error).message);
}
```

### Delete an App

This will permanently delete an application. This action is irreversible.

```typescript
// (inside an async function after initialization)
const appToDelete = 'my-nginx-app';

try {
    console.log(`Deleting app: ${appToDelete}`);
    await api.deleteApp(appToDelete); // To also delete volumes, use: api.deleteApp(appToDelete, true)
    console.log('App deleted successfully.');
} catch (error) {
    console.error(`Failed to delete ${appToDelete}:`, (error as Error).message);
}
```

### Create a Server Backup

This creates a full server backup and downloads it to a local file.

```typescript
// (inside an async function after initialization)

try {
    console.log('Starting server backup...');
    // You can optionally provide a file name, e.g., api.createBackup('my-backup.tar')
    const backupPath = await api.createBackup();
    console.log(`Backup successfully saved to: ${backupPath}`);
} catch (error) {
    console.error('Failed to create backup:', (error as Error).message);
}
```

## Key Differences from the Python Library

If you are coming from the Python version, here are the main changes to be aware of:

- **Asynchronous by Default**: Every API call returns a Promise. You must use `await` to get the result.
- **camelCase Naming**: All methods and properties use camelCase (e.g., `listApps`) instead of snake_case (e.g., `list_apps`).
- **Static create Method**: You must initialize the library with `await CaproverAPI.create()` instead of calling a class constructor directly.
- **Error Handling**: Errors are thrown via Promise rejections. Use a try/catch block to handle them.
- **Response Structure**: All successful API calls return a response object with the following structure:

```typescript
{
  status: number,
  description: string,
  data: { ... } // The actual payload is here
}
```

You will typically access the result via the `.data` property (e.g., `(await api.listApps()).data.appDefinitions`).

## Contributing

Contributions are welcome! If you'd like to contribute, please feel free to fork the repository and submit a pull request.

### Running Tests

To run the test suite locally:

1. Clone the repository
2. Install development dependencies: `npm install`
3. Run the tests: `npm test`

## Be a Sponsor
- https://github.com/sponsors/willvin313

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
