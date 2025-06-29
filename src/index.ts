// src/index.ts

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// Helper function to pause execution, equivalent to time.sleep()
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const PUBLIC_ONE_CLICK_APP_PATH = "https://raw.githubusercontent.com/caprover/one-click-apps/master/public/v4/apps/";

// Type definitions to make our code safer and easier to use
/**
 * A generic wrapper for the standard CapRover API response structure.
 */
interface CaproverResponse<T> {
    status: number;
    description: string;
    data: T;
}

type AppVariable = {
    id: string;
    label: string;
    defaultValue?: string;
    description?: string;
    validRegex?: string;
};

type AppDefinition = {
    appName: string;
    hasPersistentData: boolean;
    instanceCount: number;
    volumes: { volumeName: string }[];
    envVars: { key: string; value: any }[];
    // Add other properties as needed from the CapRover API response
    [key: string]: any;
};

/**
 * Type for the data object returned by getAppInfo.
 */
type AppData = {
    isAppBuilding: boolean;
    isBuildFailed: boolean;
    [key: string]: any;
};

/**
 * Options for initializing the CaproverAPI client.
 */
export interface CaproverApiOptions {
    dashboardUrl: string;
    password: string;
    protocol?: 'http://' | 'https://';
    schemaVersion?: number;
    captainNamespace?: string;
}

export class CaproverAPI {
    // A collection of status codes, similar to the Python inner class
    public static Status = {
        STATUS_ERROR_GENERIC: 1000,
        STATUS_OK: 100,
        STATUS_OK_DEPLOY_STARTED: 101,
        STATUS_OK_PARTIALLY: 102,
        STATUS_ERROR_CAPTAIN_NOT_INITIALIZED: 1001,
        STATUS_ERROR_USER_NOT_INITIALIZED: 1101,
        STATUS_ERROR_NOT_AUTHORIZED: 1102,
        STATUS_ERROR_ALREADY_EXIST: 1103,
        STATUS_ERROR_BAD_NAME: 1104,
        STATUS_WRONG_PASSWORD: 1105,
        STATUS_AUTH_TOKEN_INVALID: 1106,
        VERIFICATION_FAILED: 1107,
        ILLEGAL_OPERATION: 1108,
        BUILD_ERROR: 1109,
        ILLEGAL_PARAMETER: 1110,
        NOT_FOUND: 1111,
        AUTHENTICATION_FAILED: 1112,
        STATUS_PASSWORD_BACK_OFF: 1113,
    };

    // API Path constants
    private static LOGIN_PATH = '/api/v2/login';
    private static SYSTEM_INFO_PATH = "/api/v2/user/system/info";
    private static APP_LIST_PATH = "/api/v2/user/apps/appDefinitions";
    private static APP_REGISTER_PATH = '/api/v2/user/apps/appDefinitions/register';
    private static APP_DELETE_PATH = '/api/v2/user/apps/appDefinitions/delete';
    private static ADD_CUSTOM_DOMAIN_PATH = '/api/v2/user/apps/appDefinitions/customdomain';
    private static UPDATE_APP_PATH = '/api/v2/user/apps/appDefinitions/update';
    private static ENABLE_BASE_DOMAIN_SSL_PATH = '/api/v2/user/apps/appDefinitions/enablebasedomainssl';
    private static ENABLE_CUSTOM_DOMAIN_SSL_PATH = '/api/v2/user/apps/appDefinitions/enablecustomdomainssl';
    private static APP_DATA_PATH = '/api/v2/user/apps/appData';
    private static CREATE_BACKUP_PATH = '/api/v2/user/system/createbackup';
    private static DOWNLOAD_BACKUP_PATH = '/api/v2/downloads/';
    private static TRIGGER_BUILD_PATH = '/api/v2/user/apps/webhooks/triggerbuild';


    private axios: AxiosInstance;
    private readonly baseUrl: string;
    private readonly password: string;
    private readonly captainNamespace: string;
    private readonly schemaVersion: number;
    private rootDomain: string = '';

    /**
     * The constructor is private to enforce async initialization via `CaproverAPI.create()`.
     */
    private constructor(options: CaproverApiOptions) {
        const {
            dashboardUrl,
            password,
            protocol = 'https://',
            schemaVersion = 2,
            captainNamespace = 'captain',
        } = options;

        this.password = password;
        this.captainNamespace = captainNamespace;
        this.schemaVersion = schemaVersion;

        const cleanUrl = dashboardUrl.split("/#")[0].replace(/\/$/, "");
        this.baseUrl = cleanUrl.startsWith('http') ? cleanUrl : protocol + cleanUrl;

        this.axios = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'x-namespace': this.captainNamespace,
                'content-type': 'application/json;charset=UTF-8',
            },
        });
    }

    /**
     * Creates and initializes a new CaproverAPI instance.
     * This is the correct way to instantiate the class due to async login requirements.
     * @param options - Configuration for the API client.
     * @returns A promise that resolves to a fully authenticated CaproverAPI instance.
     */
    public static async create(options: CaproverApiOptions): Promise<CaproverAPI> {
        const api = new CaproverAPI(options);
        await api._login();

        const systemInfo = await api.getSystemInfo();
        api.rootDomain = systemInfo.data.rootDomain;

        return api;
    }

    /**
     * A retry helper to wrap around API calls, replacing the Python decorator.
     * @param asyncFunc The async function to execute.
     * @param times The number of times to retry.
     * @param delay The delay in ms between retries.
     */
    private async _retry<T>(asyncFunc: () => Promise<T>, times: number = 3, delay: number = 1000): Promise<T> {
        let attempt = 0;
        while (attempt < times) {
            try {
                return await asyncFunc();
            } catch (error) {
                attempt++;
                const isNetworkError = error instanceof AxiosError && error.code !== 'ECONNABORTED';

                if (isNetworkError && attempt < times) {
                    console.error(`Attempt ${attempt} failed. Retrying in ${delay}ms...`, (error as Error).message);
                    await sleep(delay);
                } else {
                    throw error;
                }
            }
        }
        throw new Error('Retry mechanism failed.');
    }

    /**
     * Checks the response from the CapRover API for errors.
     * Throws an exception if the status is not 'OK'.
     * @param response - The API response object.
     */
    private _checkErrors<T>(response: CaproverResponse<T>): CaproverResponse<T> {
        const { status, description } = response;
        if (status !== CaproverAPI.Status.STATUS_OK && status !== CaproverAPI.Status.STATUS_OK_PARTIALLY) {
            console.error(description);
            throw new Error(description);
        }
        console.log(description);
        return response;
    }

    private async _login(): Promise<void> {
        console.log("Attempting to login to CapRover dashboard...");
        const data = { password: this.password };
        const response = await this.axios.post<CaproverResponse<{ token: string }>>(CaproverAPI.LOGIN_PATH, data);
        const checkedResponse = this._checkErrors(response.data);
        const token = checkedResponse.data.token;

        this.axios.defaults.headers.common['x-captain-auth'] = token;
    }

    public async getSystemInfo() {
        return this._retry(async () => {
            const response = await this.axios.get<CaproverResponse<{ rootDomain: string }>>(CaproverAPI.SYSTEM_INFO_PATH);
            return this._checkErrors(response.data);
        });
    }

    public async listApps() {
        return this._retry(async () => {
            const response = await this.axios.get<CaproverResponse<{ appDefinitions: AppDefinition[] }>>(CaproverAPI.APP_LIST_PATH);
            return this._checkErrors(response.data);
        });
    }

    public async getApp(appName: string): Promise<AppDefinition | null> {
        const appList = await this.listApps();
        return appList.data.appDefinitions.find((app: AppDefinition) => app.appName === appName) || null;
    }

    public async createApp(appName: string, hasPersistentData: boolean, wait: boolean = true) {
        console.log(`Creating new app: ${appName}`);
        const data = { appName, hasPersistentData };
        const response = await this._retry(() => this.axios.post(CaproverAPI.APP_REGISTER_PATH, data));

        this._checkErrors(response.data);

        if (wait) {
            await this._waitUntilAppReady(appName);
        }
        return response.data;
    }
    // Add these inside your CaproverAPI class in src/index.ts

    public async addDomain(appName: string, customDomain: string) {
        console.log(`${appName} | Adding custom domain: ${customDomain}`);
        const data = { appName, customDomain };
        const response = await this._retry(() => this.axios.post<CaproverResponse<any>>(CaproverAPI.ADD_CUSTOM_DOMAIN_PATH, data));
        return this._checkErrors(response.data);
    }

    public async enableSsl(appName: string, customDomain?: string) {
        let path: string;
        let data: object;

        if (customDomain) {
            console.log(`${appName} | Enabling SSL for custom domain: ${customDomain}`);
            path = CaproverAPI.ENABLE_CUSTOM_DOMAIN_SSL_PATH;
            data = { appName, customDomain };
        } else {
            console.log(`${appName} | Enabling SSL for default CapRover domain`);
            path = CaproverAPI.ENABLE_BASE_DOMAIN_SSL_PATH;
            data = { appName };
        }

        const response = await this._retry(() => this.axios.post<CaproverResponse<any>>(path, data));
        return this._checkErrors(response.data);
    }
    
    public async updateApp(appName: string, updates: Partial<AppDefinition> & { [key: string]: any }) {
        console.log(`${appName} | Updating app info...`);

        const currentAppInfo = await this.getApp(appName);
        if (!currentAppInfo) {
            throw new Error(`App '${appName}' not found.`);
        }

        // Deep merge environment variables
        if (updates.envVars) {
            const currentEnvVars = currentAppInfo.envVars.reduce((acc: any, v: any) => ({ ...acc, [v.key]: v.value }), {});
            const newEnvVars = updates.envVars.reduce((acc: any, v: any) => ({ ...acc, [v.key]: v.value }), {});
            const merged = { ...currentEnvVars, ...newEnvVars };
            updates.envVars = Object.entries(merged).map(([key, value]) => ({ key, value }));
        }

        // Merge and send the full object
        const data = { ...currentAppInfo, ...updates };

        const response = await this._retry(() => this.axios.post(CaproverAPI.UPDATE_APP_PATH, data));
        return this._checkErrors(response.data);
    }

    public async deployApp(appName: string, options: { imageName?: string; dockerfileLines?: string[] }) {
        let definition: any = { schemaVersion: this.schemaVersion };
        if (options.imageName) {
            definition.imageName = options.imageName;
        } else if (options.dockerfileLines) {
            definition.dockerfileLines = options.dockerfileLines;
        } else {
            throw new Error('Either imageName or dockerfileLines must be provided.');
        }

        const data = {
            captainDefinitionContent: JSON.stringify(definition),
            gitHash: ""
        };

        const response = await this._retry(() => this.axios.post(`${CaproverAPI.APP_DATA_PATH}/${appName}`, data));

        this._checkErrors(response.data);
        await this._waitUntilAppReady(appName);
        await sleep(500); // Small delay to ensure build status is updated
        await this._ensureAppBuildSuccess(appName);

        return response.data;
    }

    public async deleteApp(appName: string, deleteVolumes: boolean = false) {
        let data: { appName: string; volumes?: string[] };

        if (deleteVolumes) {
            console.log(`Deleting app ${appName} and its volumes...`);
            const app = await this.getApp(appName);
            if (!app) throw new Error(`App ${appName} not found.`);
            data = {
                appName,
                volumes: app.volumes.map((v: any) => v.volumeName)
            };
        } else {
            console.log(`Deleting app ${appName}`);
            data = { appName };
        }
        const response = await this._retry(() => this.axios.post(CaproverAPI.APP_DELETE_PATH, data));
        return this._checkErrors(response.data);
    }

    /**
     * Deploys a one-click app from a public or private repository.
     */
    public async deployOneClickApp(
        oneClickAppName: string,
        appName: string,
        appVariables: Record<string, string | number>,
        oneClickRepository: string = PUBLIC_ONE_CLICK_APP_PATH
    ) {
        console.log(`Starting one-click deployment for ${oneClickAppName} as ${appName}`);

        // 1. Download app definition
        const rawAppDefinition = await this._downloadOneClickAppDefn(oneClickRepository, oneClickAppName);

        // 2. Resolve variables
        const resolvedAppData = this._resolveAppVariables(rawAppDefinition, appName, appVariables);
        const appData = yaml.load(resolvedAppData) as any;
        const services = appData.services as Record<string, any>;
        const serviceNames = Object.keys(services);

        const deployed: Set<string> = new Set();

        // 3. Deploy services respecting `depends_on`
        let servicesToProcess = new Set(serviceNames);
        while (deployed.size < serviceNames.length) {
            let deployedInThisPass = 0;
            for (const serviceName of servicesToProcess) {
                const serviceData = services[serviceName];
                const dependencies = serviceData.depends_on || [];

                // Check if all dependencies are met
                const canDeploy = dependencies.every((dep: string) => deployed.has(dep));

                if (canDeploy) {
                    console.log(`Deploying service: ${serviceName}`);

                    const hasPersistentData = !!serviceData.volumes;
                    await this.createApp(serviceName, hasPersistentData, true);

                    const environment_variables = serviceData.environment || {};
                    const caprover_extras = serviceData.caproverExtra || {};

                    // Prepare update payload
                    const updates: any = {
                        instanceCount: 1,
                        environment_variables: Object.entries(environment_variables).map(([key, value]) => ({ key, value })),
                        notExposeAsWebApp: caprover_extras.notExposeAsWebApp === 'true',
                        containerHttpPort: caprover_extras.containerHttpPort || 80,
                    };

                    if (serviceData.volumes) {
                        updates.volumes = serviceData.volumes.map((v: string) => {
                            const [volumeName, containerPath] = v.split(':');
                            return volumeName.startsWith('/')
                                ? { hostPath: volumeName, containerPath }
                                : { volumeName, containerPath };
                        });
                    }

                    await this.updateApp(serviceName, updates);

                    await this.deployApp(serviceName, {
                        imageName: serviceData.image,
                        dockerfileLines: caprover_extras.dockerfileLines
                    });

                    deployed.add(serviceName);
                    servicesToProcess.delete(serviceName); // Remove from processing queue
                    deployedInThisPass++;
                }
            }

            if (deployedInThisPass === 0 && servicesToProcess.size > 0) {
                throw new Error(`Circular dependency or missing dependency detected. Cannot deploy: ${[...servicesToProcess].join(', ')}`);
            }
        }

        return this._checkErrors({
            status: CaproverAPI.Status.STATUS_OK,
            description: `Deployed all services in >>${oneClickAppName}<<`,
            data: { success: true }
        });
    }

    public async createBackup(fileName?: string) {
        if (!fileName) {
            const dateStr = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
            fileName = `${this.captainNamespace}-bck-${dateStr}.tar`;
        }

        console.log(`Creating backup file: ${fileName}`);
        const createResponse = await this._retry(() => this.axios.post<CaproverResponse<{ downloadToken: string }>>(
            CaproverAPI.CREATE_BACKUP_PATH,
            { postDownloadFileName: fileName }
        ));

        const { downloadToken } = this._checkErrors(createResponse.data).data;

        console.log('Downloading backup...');
        const downloadResponse = await this._retry(() => this.axios.get(CaproverAPI.DOWNLOAD_BACKUP_PATH, {
            params: { namespace: this.captainNamespace, downloadToken },
            responseType: 'stream'
        }));

        const absolutePath = path.resolve(fileName);
        await fs.writeFile(absolutePath, downloadResponse.data);
        console.log(`Backup saved to ${absolutePath}`);

        return absolutePath;
    }

    // "Private" helper methods (conventionally prefixed with _)

    private async getAppInfo(appName: string) {
        return this._retry(async () => {
            const response = await this.axios.get<CaproverResponse<AppData>>(`${CaproverAPI.APP_DATA_PATH}/${appName}`);
            return this._checkErrors(response.data);
        });
    }

    private async _waitUntilAppReady(appName: string) {
        const timeout = 60; // 60 seconds
        for (let i = 0; i < timeout; i++) {
            await sleep(1000);
            const appInfo = await this.getAppInfo(appName);
            if (!appInfo.data?.isAppBuilding) {
                console.log("App building finished...");
                return appInfo;
            }
        }
        throw new Error("App building timeout reached");
    }

    private async _ensureAppBuildSuccess(appName: string) {
        const appInfo = await this.getAppInfo(appName);
        if (appInfo.data?.isBuildFailed) {
            throw new Error(`App build failed for ${appName}. Check the CapRover logs.`);
        }
        return appInfo;
    }

    private async _downloadOneClickAppDefn(repositoryPath: string, oneClickAppName: string): Promise<string> {
        const url = `${repositoryPath}${oneClickAppName}.yml`;
        console.log(`Downloading one-click app definition from ${url}`);
        const response = await axios.get(url);
        return response.data;
    }

    private _resolveAppVariables(
        rawAppDefinition: string,
        capAppName: string,
        appVariables: Record<string, string | number>
    ): string {
        let rawAppData = rawAppDefinition;

        rawAppData = rawAppData.replace(/\$\$cap_gen_random_hex\((\d+)\)/g, (_, lengthStr) => {
            const length = parseInt(lengthStr, 10);
            return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
        });

        // FIX: Define the type of allVariables to allow any string key.
        const allVariables: Record<string, string | number> = {
            ...appVariables,
            '$$cap_appname': capAppName,
            '$$cap_root_domain': this.rootDomain,
        };

        const appDefn = yaml.load(rawAppData) as any;
        const requiredVars: AppVariable[] = appDefn?.caproverOneClickApp?.variables || [];

        for (const reqVar of requiredVars) {
            // FIX: These checks are now valid due to the Record<string, ...> type.
            if (allVariables[reqVar.id] === undefined || allVariables[reqVar.id] === null) {
                if (reqVar.defaultValue !== undefined) {
                    allVariables[reqVar.id] = reqVar.defaultValue;
                } else {
                    throw new Error(`Missing required variable: ${reqVar.label} (${reqVar.id}). Description: ${reqVar.description}`);
                }
            }
        }

        for (const [id, value] of Object.entries(allVariables)) {
            rawAppData = rawAppData.replace(new RegExp(id.replace('$$', '\\$\\$'), 'g'), String(value));
        }

        return rawAppData;
    }
}