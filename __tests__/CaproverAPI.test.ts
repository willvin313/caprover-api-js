import { CaproverAPI, CaproverApiOptions } from '../src/index';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';

// Mock the external dependencies
jest.mock('axios');
jest.mock('fs/promises');

// Cast the mocked modules for type safety and autocompletion
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

// --- Reusable Mock Data and Helpers ---
const testOptions: CaproverApiOptions = {
    dashboardUrl: 'https://captain.mydomain.com',
    password: 'test-password',
};

const mockSuccessResponse = (data: any = {}) => ({
    status: 100, // STATUS_OK
    description: 'Request was successful.',
    data,
});

const mockAppList = {
    appDefinitions: [
        { appName: 'app-1', instanceCount: 1, envVars: [{ key: 'VAR1', value: 'VAL1' }] },
        { appName: 'app-2', instanceCount: 2, envVars: [] },
    ],
};

const mockOneClickAppYaml = `
caproverOneClickApp:
  variables:
    - id: $$cap_db_pass
      label: Database Password
      defaultValue: secret
services:
  main-service:
    image: my-image:latest
    depends_on:
      - db-service
  db-service:
    image: postgres:latest
`;

const appName = 'my-ssl-app';
const customDomain = 'test.mydomain.com';

// --- Test Suite ---
describe('CaproverAPI', () => {
    let api: CaproverAPI;

    // This block runs before each test, similar to Python's setUp
    beforeEach(async () => {
        // Clear all mocks to ensure test isolation
        jest.clearAllMocks();

        // Mock the axios.create method to return the mockedAxios instance
        mockedAxios.create.mockReturnThis();

        // Mock the initialization sequence (login + getSystemInfo)
        mockedAxios.post.mockResolvedValueOnce({
            data: mockSuccessResponse({ token: 'fake-jwt-token' }),
        });
        mockedAxios.get.mockResolvedValueOnce({
            data: mockSuccessResponse({ rootDomain: 'app.mydomain.com' }),
        });

        // Create a new, fully authenticated instance for each test
        api = await CaproverAPI.create(testOptions);

        // Clear the init calls so they don't interfere with individual test assertions
        mockedAxios.post.mockClear();
        mockedAxios.get.mockClear();
    });

    it('test_list_apps: should fetch a list of apps', async () => {
        // Arrange
        mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse(mockAppList) });

        // Act
        const result = await api.listApps();

        // Assert
        expect(mockedAxios.get).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions');
        expect(result.data.appDefinitions).toHaveLength(2);
    });

    it('test_get_app: should filter and return a single app', async () => {
        // Arrange
        mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse(mockAppList) });

        // Act
        const result = await api.getApp('app-1');

        // Assert
        expect(result?.appName).toBe('app-1');
        expect(mockedAxios.get).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions');
    });

    it('test_create_app: should send a correct request to create an app', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });
        // Mock the getAppInfo call from _waitUntilAppReady
        mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse({ isAppBuilding: false }) });

        // Act
        await api.createApp('new-app', true);

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions/register', {
            appName: 'new-app',
            hasPersistentData: true,
        });
    });

    it('test_delete_app: should send a correct request to delete an app', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });

        // Act
        await api.deleteApp('app-to-delete', false);

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions/delete', {
            appName: 'app-to-delete',
        });
    });

    it('test_update_app: should merge current and new app data correctly', async () => {
        // Arrange
        const appName = 'app-1';
        const currentApp = mockAppList.appDefinitions.find(a => a.appName === appName);
        const updates = {
            instanceCount: 5,
            envVars: [{ key: 'NEW_VAR', value: 'NEW_VAL' }],
        };

        // Mock the getApp call to return the current app state
        mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse(mockAppList) });
        // Mock the final update post call
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });

        // Act
        await api.updateApp(appName, updates);

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions/update',
            expect.objectContaining({
                appName: appName,
                instanceCount: 5, // The new value
                // Check that env vars were merged, not just replaced
                envVars: expect.arrayContaining([
                    { key: 'VAR1', value: 'VAL1' },
                    { key: 'NEW_VAR', value: 'NEW_VAL' }
                ])
            })
        );
    });

    it('test_deploy_app: should send the correct payload for image deployment', async () => {
        // Arrange
        const appName = 'my-app';
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });
        // Mock the status checks
        mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse({ isAppBuilding: false, isBuildFailed: false }) });

        // Act
        await api.deployApp(appName, { imageName: 'nginx:latest' });

        // Assert
        const expectedDefinition = JSON.stringify({ schemaVersion: 2, imageName: 'nginx:latest' });
        expect(mockedAxios.post).toHaveBeenCalledWith(`/api/v2/user/apps/appData/${appName}`, {
            captainDefinitionContent: expectedDefinition,
            gitHash: "",
        });
    });

    it('test_deploy_one_click_app: should deploy services in the correct order', async () => {
        // Arrange
        // 1. Mock the initial download of the YAML file.
        mockedAxios.get.mockResolvedValueOnce({ data: mockOneClickAppYaml });

        // 2. Mock all POST requests to be successful.
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });

        // 3. Use a mock implementation for subsequent GET requests.
        mockedAxios.get.mockImplementation((url: string) => {
            // FIX: When listApps is called (from within getApp -> updateApp),
            // we must return a list that includes the apps that have just been "created".
            if (url.includes('/api/v2/user/apps/appDefinitions')) {
                return Promise.resolve({
                    data: mockSuccessResponse({
                        appDefinitions: [
                            // Provide mock data for the apps being created in the test.
                            // They need `appName` and `envVars` to satisfy the updateApp logic.
                            { appName: 'db-service', instanceCount: 0, envVars: [] },
                            { appName: 'main-service', instanceCount: 0, envVars: [] },
                        ],
                    }),
                });
            }

            // When status checks are called, provide a valid status.
            if (url.includes('/api/v2/user/apps/appData/')) {
                return Promise.resolve({ data: mockSuccessResponse({ isAppBuilding: false, isBuildFailed: false }) });
            }

            return Promise.reject(new Error(`Unexpected GET request to ${url} in this test.`));
        });

        // Act
        await api.deployOneClickApp('my-app', 'my-app-instance', {});

        // Assert
        const calls = mockedAxios.post.mock.calls;

        // Expect 6 POST calls: create, update, deploy for db-service, then create, update, deploy for main-service
        expect(calls).toHaveLength(6);

        // Check that db-service (the dependency) was created first.
        expect(calls[0][0]).toBe('/api/v2/user/apps/appDefinitions/register');
        expect(calls[0][1]).toEqual({ appName: 'db-service', hasPersistentData: false });

        // The second call is now the updateApp call for db-service
        expect(calls[1][0]).toBe('/api/v2/user/apps/appDefinitions/update');
        expect((calls[1][1] as { appName: string }).appName).toBe('db-service');

        // Check that main-service was created after the dependency.
        expect(calls[3][0]).toBe('/api/v2/user/apps/appDefinitions/register');
        expect(calls[3][1]).toEqual({ appName: 'main-service', hasPersistentData: false });
    }, 15000);

    it('test_create_backup: should call create and download endpoints', async () => {
        // Arrange
        const downloadToken = 'fake-download-token';
        // Mock the POST to create the backup token
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse({ downloadToken }) });
        // Mock the GET to download the backup file (as a stream/buffer)
        mockedAxios.get.mockResolvedValue({ data: 'backup-file-content' });
        // Mock the file system write to avoid actual file I/O
        mockedFs.writeFile.mockResolvedValue();

        // Act
        const result = await api.createBackup('my-backup.tar');

        // Assert
        // 1. Check that the backup creation was requested
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/user/system/createbackup', {
            postDownloadFileName: 'my-backup.tar',
        });

        // 2. Check that the download was requested with the correct token
        expect(mockedAxios.get).toHaveBeenCalledWith('/api/v2/downloads/', expect.objectContaining({
            params: { namespace: 'captain', downloadToken }
        }));

        // 3. Check that the file was written to the (mocked) file system
        expect(mockedFs.writeFile).toHaveBeenCalledWith(expect.stringContaining('my-backup.tar'), 'backup-file-content');
    });

    it('test_add_domain: should send the correct request to add a custom domain', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });

        // Act
        await api.addDomain(appName, customDomain);

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions/customdomain', {
            appName: appName,
            customDomain: customDomain,
        });
    });

    it('test_enable_ssl_for_custom_domain: should send the correct request for a custom domain', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });

        // Act
        await api.enableSsl(appName, customDomain);

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions/enablecustomdomainssl', {
            appName: appName,
            customDomain: customDomain,
        });
    });

    it('test_enable_ssl_for_base_domain: should send the correct request for a default domain', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });

        // Act
        await api.enableSsl(appName); // Note: no customDomain argument

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions/enablebasedomainssl', {
            appName: appName,
        });
    });
});