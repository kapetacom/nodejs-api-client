import * as FS from 'fs';
import jwt_decode from 'jwt-decode';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import type { Options, Response } from 'request';
const request = require('request');

const AUTH_TOKEN = ClusterConfiguration.getAuthenticationPath();
const DEFAULT_CLIENT_ID = '63bbeafc39388b47691111ae';

interface TokenInfo {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
}

interface Context {
    id: string;
    type: string;
    handle: string;
    scopes: string[];
}

export interface AuthPayload {
    grant_type: string;
    [key: string]: any;
}

export interface AuthInfo {
    client_id?: string;
    access_token?: string;
    token_type?: string;
    expire_time?: any;
    scope?: string;
    refresh_token?: string;
    context?: Context | null;
    base_url: string;
}

export interface UserInfo {
    sub?: string;
    auth_type?: string;
    auth_id?: string;
    purpose?: string;
    iss?: string;
    scopes?: string[];
    contexts?: Context[];
    type?: string;
    exp?: number;
    iat?: number;
}

export interface RequestOptions {
    url: string;
    method?: string;
    auth?: boolean;
    headers?: { [key: string]: string };
    body?: any;
}

export interface DeviceAuthenticationHandler {
    onVerificationCode?: (redirectTo: string) => void;
}

export class KapetaAPI {
    private _authInfo?: AuthInfo;
    private _userInfo: UserInfo;

    constructor(authInfo?: AuthInfo) {
        this._authInfo = authInfo;
        this._userInfo = {};
        if (!authInfo) {
            this.readToken();
        }
    }

    public getClientId() {
        if (process?.env?.KAPETA_CLIENT_ID) {
            return process?.env?.KAPETA_CLIENT_ID;
        }

        return this?._authInfo?.client_id || DEFAULT_CLIENT_ID;
    }

    public getUserInfo() {
        return this._userInfo;
    }

    public hasJWTToken() {
        return !!process?.env?.KAPETA_CREDENTIALS_TOKEN;
    }

    public getJWTToken() {
        if (!process?.env?.KAPETA_CREDENTIALS_TOKEN) {
            return null;
        }
        //JWT Provided
        return JSON.parse(Buffer.from(process.env.KAPETA_CREDENTIALS_TOKEN, 'base64').toString('ascii')).token;
    }

    public hasToken() {
        if (this.hasJWTToken()) {
            return true;
        }
        return this._authInfo && this._authInfo.access_token;
    }

    public getTokenPath() {
        return AUTH_TOKEN;
    }

    public readToken() {
        if (FS.existsSync(this.getTokenPath())) {
            this._authInfo = JSON.parse(FS.readFileSync(this.getTokenPath()).toString());
            this._userInfo = jwt_decode(this._authInfo!.access_token!);
        }
    }

    public getBaseUrl() {
        if (process?.env?.KAPETA_SERVICE_URL) {
            return process.env.KAPETA_SERVICE_URL;
        }

        if (this._authInfo?.base_url) {
            return this._authInfo?.base_url;
        }

        return 'https://app.kapeta.com';
    }

    private async createDeviceCode() {
        return this._send({
            url: `${this.getBaseUrl()}/oauth2/device/code`,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                accept: 'application/json',
            },
            method: 'POST',
            body: new URLSearchParams({
                client_id: this.getClientId(),
            }).toString(),
        });
    }

    /**
     *
     */
    public async doDeviceAuthentication(handler?: DeviceAuthenticationHandler) {
        let { device_code, verification_uri_complete, expires_in, interval } = await this.createDeviceCode();

        if (handler?.onVerificationCode) {
            handler.onVerificationCode(verification_uri_complete);
        }

        if (!interval || interval < 5) {
            interval = 5;
        }

        const expireTime = Date.now() + expires_in * 1000;
        const me = this;

        return new Promise<void>((resolve, reject) => {
            function tryAuthorize() {
                setTimeout(async () => {
                    if (expireTime < Date.now()) {
                        //Expired
                        reject(new Error('You failed to complete verification in time. Please try again'));
                        return;
                    }

                    try {
                        const token = await me.authorize({
                            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                            device_code,
                        });

                        //We need to save the specific time
                        me.saveToken(token);

                        resolve();
                    } catch (e) {
                        tryAuthorize();
                    }
                }, interval * 1000);
            }

            tryAuthorize();
        });
    }

    public getCurrentIdentityId(): string {
        if (this._userInfo?.sub) {
            return this._userInfo.sub;
        }
        throw new Error('No current identity');
    }

    public async getCurrentIdentity() {
        return this.getIdentity(this.getCurrentIdentityId());
    }

    public getCurrentContext(): Context | null {
        return this._authInfo?.context ?? null;
    }

    public async getIdentity(identityId: string) {
        return this._sendAuthed(`/identities/${encodeURIComponent(identityId)}`);
    }

    public async getCurrentMemberships() {
        return this.getMemberships(this.getCurrentIdentityId());
    }

    public async getMemberships(identityId: string) {
        return this._sendAuthed(`/identities/${encodeURIComponent(identityId)}/memberships?type=organization`);
    }

    public async getByHandle(handle: string) {
        return this._sendAuthed(`/identities/by-handle/${encodeURIComponent(handle)}/as-member`);
    }

    public async removeContext() {
        if (this._authInfo) {
            this._authInfo.context = null;
        }
        this._updateToken();
    }

    public async switchContextTo(handle: string) {
        const membership = await this.getByHandle(handle);
        if (!membership) {
            throw { error: 'Organization not found' };
        }
        if (this._authInfo) {
            this._authInfo.context = membership;
        }

        this._updateToken();
        return membership;
    }

    private async _sendAuthed(path: string, method: string = 'GET', body?: any) {
        const url = `${this.getBaseUrl()}/api${path}`;
        return this.send({
            url,
            auth: true,
            method: method,
            body,
        });
    }

    public async send<T = any>(opts: RequestOptions):Promise<T> {
        if (!opts.headers) {
            opts.headers = {};
        }

        Object.assign(opts.headers, {
            accept: 'application/json',
        });

        if (opts.auth) {
            const accessToken = await this.getAccessToken();
            Object.assign(opts.headers, {
                authorization: `Bearer ${accessToken}`,
            });
        }

        return this._send({
            url: opts.url,
            method: opts.method,
            headers: opts.headers,
            body: opts.body,
        });
    }

    public async ensureAccessToken() {
        if (this.hasJWTToken()) {
            let jwtToken = this.getJWTToken();
            const token = await this.authorize({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwtToken,
            });
            this.saveToken(token);
            return;
        }

        if (
            this._authInfo &&
            this._authInfo.expire_time &&
            this._authInfo.refresh_token &&
            this._authInfo.expire_time < Date.now()
        ) {
            const token = await this.authorize({
                grant_type: 'refresh_token',
                refresh_token: this._authInfo.refresh_token,
            });
            this.saveToken(token);
            return;
        }

        if (!this._authInfo) {
            throw new Error('Authentication not found');
        }
    }

    public async getAccessToken() {
        await this.ensureAccessToken();

        return this._authInfo?.access_token;
    }

    public async authorize(payload: AuthPayload): Promise<TokenInfo> {
        return this._send({
            url: `${this.getBaseUrl()}/oauth2/token`,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                accept: 'application/json',
            },
            method: 'POST',
            body: new URLSearchParams({
                ...payload,
                client_id: this.getClientId(),
            }).toString(),
        });
    }

    private async _send(opts: Options): Promise<any> {
        return new Promise((resolve, reject) => {
            request(opts, (err: any, response: Response, responseBody: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (response.statusCode > 299) {
                    if (response.statusCode === 404) {
                        resolve(null);
                        return;
                    }
                    const errorBody = responseBody
                        ? JSON.parse(responseBody)
                        : { error: 'Not found', status: response.statusCode };
                    reject(errorBody);
                    return;
                }

                try {
                    resolve(JSON.parse(responseBody));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    public removeToken() {
        if (FS.existsSync(this.getTokenPath())) {
            FS.unlinkSync(this.getTokenPath());
            this._authInfo = {
                base_url: this.getBaseUrl(),
            };
            return true;
        }

        return false;
    }

    public saveToken(token: TokenInfo) {
        this._authInfo = {
            ...token,
            client_id: this.getClientId(),
            base_url: this.getBaseUrl(),
            context: this._authInfo?.context || null,
            expire_time: Date.now() + token.expires_in,
        };
        this._userInfo = jwt_decode(this._authInfo.access_token!);
        this._updateToken();
    }

    private _updateToken() {
        FS.writeFileSync(this.getTokenPath(), JSON.stringify(this._authInfo, null, 2));
    }
}
