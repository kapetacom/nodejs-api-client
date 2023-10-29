/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

import * as FS from 'fs';
import jwt_decode from 'jwt-decode';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import type { Options, Response } from 'request';
const request = require('request');

const AUTH_TOKEN = ClusterConfiguration.getAuthenticationPath();
const DEFAULT_CLIENT_ID = '63bbeafc39388b47691111ae';

class APIError extends Error {
    public status: number = 0;
    public url: string = '';
    public method: string = 'GET';

    constructor(message: string) {
        super(message);
    }
}

interface TokenInfo {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
}

export interface Context {
    id: string;
    type: string;
    handle: string;
    scopes: string[];
}
export interface IdentityIdentifier {
    id: string;
    identifier: string;
    type: string;
    scopeId: string;
    identityId: string;
    verified: boolean;
    primary: boolean;
}

export interface MemberIdentity {
    scopes: string[];
    identity: ExtendedIdentity;
}

export interface ExtendedIdentity {
    id: string;
    name: string;
    type: string;
    data: any;
    handle: string;
    email: string;
    identifiers: IdentityIdentifier[];
}

export interface Membership {
    scopes: string[];
    identity: ExtendedIdentity;
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
    context?: MemberIdentity | null;
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

interface DeviceAuthenticationResponse {
    device_code: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
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

    public getJWTToken(): string | null {
        if (!process?.env?.KAPETA_CREDENTIALS_TOKEN) {
            return null;
        }
        //JWT Provided
        try {
            return JSON.parse(Buffer.from(process.env.KAPETA_CREDENTIALS_TOKEN, 'base64').toString('ascii')).token;
        } catch (e) {
            console.log(`Failed to parse JWT token from KAPETA_CREDENTIALS_TOKEN. Got ${e}`);
            return null;
        }
    }

    public hasToken() {
        if (this.hasJWTToken()) {
            return true;
        }
        return this._authInfo?.access_token !== undefined;
    }

    public getTokenPath() {
        return AUTH_TOKEN;
    }

    private readToken() {
        try {
            if (FS.existsSync(this.getTokenPath())) {
                console.log(`Reading authentication from ${this.getTokenPath()}`);
                this._authInfo = JSON.parse(FS.readFileSync(this.getTokenPath()).toString());
                if (
                    this._authInfo?.expire_time &&
                    !this._authInfo?.refresh_token &&
                    this._authInfo.expire_time < Date.now()
                ) {
                    console.log(`Available token was expired ${this.getTokenPath()}`);
                    // Expired and no refresh token
                    this.removeToken();
                    this._authInfo = undefined;
                    return;
                }
                this._userInfo = jwt_decode(this._authInfo!.access_token!);
            }
        } catch (e) {
            console.log(`Failed to read token at ${this.getTokenPath()}. Got ${e}`);
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

    private async createDeviceCode(): Promise<DeviceAuthenticationResponse> {
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
        let deviceCodeResponse = await this.createDeviceCode(),
            interval = deviceCodeResponse.interval;

        if (handler?.onVerificationCode) {
            handler.onVerificationCode(deviceCodeResponse.verification_uri_complete);
        }

        if (!interval || interval < 5) {
            interval = 5;
        }

        const expireTime = Date.now() + deviceCodeResponse.expires_in * 1000;
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
                            device_code: deviceCodeResponse.device_code,
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

    public getCurrentContext(): MemberIdentity | null {
        return this._authInfo?.context ?? null;
    }

    public async getIdentity(identityId: string) {
        return this._sendAuthed<ExtendedIdentity>(`/identities/${encodeURIComponent(identityId)}`);
    }

    public async getCurrentMemberships() {
        return this.getMemberships(this.getCurrentIdentityId());
    }

    public async getMemberships(identityId: string) {
        return this._sendAuthed<Membership[]>(
            `/identities/${encodeURIComponent(identityId)}/memberships?type=organization`
        );
    }

    public async getByHandle(handle: string) {
        return this._sendAuthed<MemberIdentity>(`/identities/by-handle/${encodeURIComponent(handle)}/as-member`);
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

    private async _sendAuthed<T = any>(path: string, method: string = 'GET', body?: any): Promise<T> {
        const url = `${this.getBaseUrl()}/api${path}`;
        return this.send({
            url,
            auth: true,
            method: method,
            body,
        });
    }

    public async send<T = any>(opts: RequestOptions): Promise<T> {
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

    private async _send(opts: Options & { url: string }): Promise<any> {
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

                    const err = new APIError(errorBody.error || 'Unknown error');
                    err.status = errorBody.status ?? response.statusCode;
                    err.url = opts.url;
                    if (opts.method) {
                        err.method = opts.method;
                    }

                    reject(err);
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
        if (this._authInfo?.refresh_token && !token.refresh_token) {
            // Keep the refresh token
            token.refresh_token = this._authInfo.refresh_token;
        }
        this._authInfo = {
            ...token,
            client_id: this.getClientId(),
            base_url: this.getBaseUrl(),
            context: this._authInfo?.context || null,
            expire_time: Date.now() + token.expires_in,
        };

        if (!token.refresh_token) {
            console.warn('No refresh token found in new token');
        }
        this._userInfo = jwt_decode(this._authInfo.access_token!);
        this._updateToken();
    }

    private _updateToken() {
        FS.writeFileSync(this.getTokenPath(), JSON.stringify(this._authInfo, null, 2));
    }
}
