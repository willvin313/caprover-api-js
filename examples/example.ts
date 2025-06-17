import { CaproverAPI } from '../src/index';

async function main() {
    try {
        console.log('Connecting to CapRover...');
        const api = await CaproverAPI.create({
            dashboardUrl: 'https://captain.server.demo.caprover.com',
            password: 'captain42'
        });
        console.log('Successfully connected!');

        // Example 1: List all applications
        console.log('\n--- Listing Apps ---');
        const apps = await api.listApps();
        console.log(apps.data.appDefinitions.map(app => app.appName));

        // Example 2: Create, update, and deploy a new app
        const newAppName = `my-test-app-${Date.now()}`;
        console.log(`\n--- Creating App: ${newAppName} ---`);
        await api.createApp(newAppName, false);

        console.log(`\n--- Updating App: ${newAppName} ---`);
        await api.updateApp(newAppName, {
            instanceCount: 2,
            envVars: [{ key: 'GREETING', value: 'Hello World' }]
        });

        console.log(`\n--- Deploying Nginx to ${newAppName} ---`);
        await api.deployApp(newAppName, { imageName: 'nginx:latest' });
        console.log('Deployment successful!');

        // Example 3: Delete the app
        console.log(`\n--- Deleting App: ${newAppName} ---`);
        await api.deleteApp(newAppName);
        console.log('App deleted.');

    } catch (error) {
        console.error('\nAn error occurred:');
        if (error instanceof Error) {
            console.error(error.message);
        } else {
            console.error(error);
        }
        process.exit(1);
    }
}

main();