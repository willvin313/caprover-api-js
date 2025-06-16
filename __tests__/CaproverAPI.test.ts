import { CaproverAPI, CaproverApiOptions } from '../src/index';
import axios from 'axios';

// Tell Jest to mock the entire axios module
jest.mock('axios');

// We cast the mocked axios to this type to get autocompletion and type safety on our mock implementations
const mockedAxios = axios as jest.Mocked<typeof axios>;

// --- Mock Data ---
// A reusable set of options for creating the API instance
const testOptions: CaproverApiOptions = {
    dashboardUrl: 'https://captain.mydomain.com',
    password: 'test-password',
};

// A standard success response from the CapRover API
const mockSuccessResponse = (data: any = {}) => ({
    status: 100, // STATUS_OK
    description: 'Request was successful.',
    data,
});

// A standard error response
const mockErrorResponse = {
    status: 1000, // STATUS_ERROR_GENERIC
    description: 'Something went wrong!',
    data: {},
};

// --- Test Suite ---
describe('CaproverAPI', () => {
    // Before each test, clear all previous mock data and implementations
    beforeEach(() => {
        mockedAxios.create.mockReturnThis(); // Ensure the axios instance is created
        mockedAxios.get.mockClear();
        mockedAxios.post.mockClear();
    });

    describe('Initialization (create)', () => {
        it('should login, get system info, and return an initialized instance', async () => {
            // Arrange: Set up the mock responses for the initialization sequence
            mockedAxios.post.mockResolvedValueOnce({
                data: mockSuccessResponse({ token: 'fake-jwt-token' }),
            });
            mockedAxios.get.mockResolvedValueOnce({
                data: mockSuccessResponse({ rootDomain: 'app.mydomain.com' }),
            });

            // Act: Create the API instance
            const api = await CaproverAPI.create(testOptions);

            // Assert: Check that the instance was created and the correct calls were made
            expect(api).toBeInstanceOf(CaproverAPI);

            // 1. Check if login was called correctly
            expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/login', {
                password: testOptions.password,
            });

            // 2. Check if the auth token was set for subsequent requests
            // @ts-ignore - Accessing private member for testing purposes
            const instanceHeaders = mockedAxios.create.mock.results[0].value.defaults.headers;
            expect(instanceHeaders.common['x-captain-auth']).toBe('fake-jwt-token');

            // 3. Check if getSystemInfo was called
            expect(mockedAxios.get).toHaveBeenCalledWith('/api/v2/user/system/info');
        });

        it('should throw an error if login fails', async () => {
            // Arrange: Simulate a failed login
            mockedAxios.post.mockResolvedValueOnce({ data: mockErrorResponse });

            // Act & Assert: Expect the create method to throw the error from the API
            await expect(CaproverAPI.create(testOptions)).rejects.toThrow(mockErrorResponse.description);
        });
    });

    describe('App Management', () => {
        let api: CaproverAPI;

        // Before each test in this block, create a fresh, initialized API instance
        beforeEach(async () => {
            mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse({ token: 'fake-jwt-token' }) });
            mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse({ rootDomain: 'app.mydomain.com' }) });
            api = await CaproverAPI.create(testOptions);
            // Clear the init calls so they don't interfere with our test assertions
            mockedAxios.post.mockClear();
            mockedAxios.get.mockClear();
        });

        it('should list all apps', async () => {
            // Arrange
            const mockApps = { appDefinitions: [{ appName: 'app-1' }, { appName: 'app-2' }] };
            mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse(mockApps) });

            // Act
            const result = await api.listApps();

            // Assert
            expect(mockedAxios.get).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions');
            expect(result.data.appDefinitions).toHaveLength(2);
            expect(result.data.appDefinitions[0].appName).toBe('app-1');
        });

        it('should get a specific app by name', async () => {
            // Arrange
            const mockApps = { appDefinitions: [{ appName: 'app-1' }, { appName: 'app-2' }] };
            mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse(mockApps) });

            // Act
            const result = await api.getApp('app-2');

            // Assert
            expect(result?.appName).toBe('app-2');
        });

        it('should return null when getting a non-existent app', async () => {
            // Arrange
            const mockApps = { appDefinitions: [{ appName: 'app-1' }] };
            mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse(mockApps) });

            // Act
            const result = await api.getApp('non-existent-app');

            // Assert
            expect(result).toBeNull();
        });


        it('should delete an app', async () => {
            // Arrange
            mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() });

            // Act
            await api.deleteApp('my-app-to-delete');

            // Assert
            expect(mockedAxios.post).toHaveBeenCalledWith('/api/v2/user/apps/appDefinitions/delete', {
                appName: 'my-app-to-delete',
            });
        });

        it('should deploy an app using an image name', async () => {
            // Arrange
            const appName = 'my-nginx-app';
            const imageName = 'nginx:latest';
            // Mock the sequence of calls for a deployment
            mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() }); // For the deploy call itself
            mockedAxios.get.mockResolvedValue({ data: mockSuccessResponse({ isAppBuilding: false, isBuildFailed: false }) }); // For wait/ensure calls

            // Act
            await api.deployApp(appName, { imageName });

            // Assert
            const expectedDefinition = JSON.stringify({ schemaVersion: 2, imageName });
            expect(mockedAxios.post).toHaveBeenCalledWith(`/api/v2/user/apps/appData/${appName}`, {
                captainDefinitionContent: expectedDefinition,
                gitHash: "",
            });
        });

        it('should throw an error if app build fails during deployment', async () => {
            // Arrange
            const appName = 'failing-app';
            mockedAxios.post.mockResolvedValue({ data: mockSuccessResponse() }); // Initial deploy call

            mockedAxios.get.mockResolvedValueOnce({
                data: mockSuccessResponse({ isAppBuilding: false, isBuildFailed: false })
            }); // First check: still building

            mockedAxios.get.mockResolvedValueOnce({
                data: mockSuccessResponse({ isAppBuilding: false, isBuildFailed: true })
            }); // Second check: build failed

            // Act & Assert
            await expect(api.deployApp(appName, { imageName: 'some-image' })).rejects.toThrow(
                `App build failed for ${appName}. Check the CapRover logs.`
            );
        });
    });
});