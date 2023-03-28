const FS = require('fs');
const request = require('request');
const jwt_decode = require('jwt-decode').default;
const ClusterConfiguration = require('@kapeta/local-cluster-config');
const AUTH_TOKEN = ClusterConfiguration.getAuthenticationPath();
const DEFAULT_CLIENT_ID = '63bbeafc39388b47691111ae';

class KapetaAPI {
    constructor(authInfo) {
        this._authInfo = authInfo;
        this._userInfo = {};
        if (!authInfo) {
            this.readToken();
        }
    }

    getClientId() {
        if (process?.env?.KAPETA_CLIENT_ID) {
            return process?.env?.KAPETA_CLIENT_ID;
        }

        return this?._authInfo?.client_id || DEFAULT_CLIENT_ID;
    }

    getUserInfo() {
        return this._userInfo;
    }

    hasJWTToken() {
        return !!process?.env?.KAPETA_CREDENTIALS_TOKEN;
    }

    getJWTToken() {
        if (!process?.env?.KAPETA_CREDENTIALS_TOKEN) {
            return null;
        }
        //JWT Provided
        return JSON.parse(
            Buffer.from(
                process.env.KAPETA_CREDENTIALS_TOKEN,
                'base64'
            ).toString('ascii')
        ).token;
    }

    hasToken() {
        if (this.hasJWTToken()) {
            return true;
        }
        return this._authInfo && this._authInfo.access_token;
    }

    getTokenPath() {
        return AUTH_TOKEN;
    }

    readToken() {
        if (FS.existsSync(this.getTokenPath())) {
            this._authInfo = JSON.parse(
                FS.readFileSync(this.getTokenPath()).toString()
            );
            this._userInfo = jwt_decode(this._authInfo.access_token);
        }
    }

    getBaseUrl() {
        if (process?.env?.KAPETA_SERVICE_URL) {
            return process.env.KAPETA_SERVICE_URL;
        }

        if (this._authInfo?.base_url) {
            return this._authInfo?.base_url;
        }

        return 'https://app.kapeta.com';
    }

    async createDeviceCode() {
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
     * @param {{onVerificationCode:(url:string) => void}}} handler
     * @returns {Promise<void>}
     */
    async doDeviceAuthentication(handler) {
        let { device_code, verification_uri_complete, expires_in, interval } =
            await this.createDeviceCode();

        if (handler?.onVerificationCode) {
            handler.onVerificationCode(verification_uri_complete);
        }

        if (!interval || interval < 5) {
            interval = 5;
        }

        const expireTime = Date.now() + expires_in * 1000;
        const me = this;

        return new Promise((resolve, reject) => {
            function tryAuthorize() {
                setTimeout(async () => {
                    if (expireTime < Date.now()) {
                        //Expired
                        reject(
                            new Error(
                                'You failed to complete verification in time. Please try again'
                            )
                        );
                        return;
                    }

                    try {
                        const token = await me.authorize({
                            grant_type:
                                'urn:ietf:params:oauth:grant-type:device_code',
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

    getCurrentIdentityId() {
        if (this._userInfo?.sub) {
            return this._userInfo.sub;
        }
        throw new Error('No current identity');
    }

    async getCurrentIdentity() {
        return this.getIdentity(this.getCurrentIdentityId());
    }

    async getCurrentContext() {
        return this._authInfo.context;
    }

    async getIdentity(identityId) {
        return this._sendAuthed(
            `/identities/${encodeURIComponent(identityId)}`
        );
    }

    async getCurrentMemberships() {
        return this.getMemberships(this.getCurrentIdentityId());
    }

    async getMemberships(identityId) {
        return this._sendAuthed(
            `/identities/${encodeURIComponent(
                identityId
            )}/memberships?type=organization`
        );
    }

    async getByHandle(handle) {
        return this._sendAuthed(
            `/identities/by-handle/${encodeURIComponent(handle)}/as-member`
        );
    }

    async removeContext() {
        this._authInfo.context = null;
        this._updateToken();
    }

    async switchContextTo(handle) {
        const membership = await this.getByHandle(handle);
        if (!membership) {
            throw { error: 'Organization not found' };
        }
        this._authInfo.context = membership;
        this._updateToken();
        return membership;
    }

    async _sendAuthed(path, method = 'GET', body) {
        const url = `${this.getBaseUrl()}/api${path}`;
        const accessToken = await this.getAccessToken();
        return this._send({
            url,
            headers: {
                authorization: `Bearer ${accessToken}`,
                accept: 'application/json',
            },
            method: method,
            body,
        });
    }

    async ensureAccessToken() {
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
            this._authInfo?.expire_time &&
            this._authInfo?.refresh_token &&
            this._authInfo.expire_time < Date.now()
        ) {
            const token = await this.authorize({
                grant_type: 'refresh_token',
                refresh_token: this._authInfo.refresh_token,
            });
            this.saveToken(token);
        }
    }

    async getAccessToken() {
        await this.ensureAccessToken();

        return this._authInfo.access_token;
    }

    async authorize(payload) {
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

    async _send(opts) {
        return new Promise((resolve, reject) => {
            request(opts, (err, response, responseBody) => {
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

    removeToken() {
        if (FS.existsSync(this.getTokenPath())) {
            FS.unlinkSync(this.getTokenPath());
            this._authInfo = {
                base_url: this.getBaseUrl(),
            };
            return true;
        }

        return false;
    }

    saveToken(token) {
        this._authInfo = {
            ...token,
            client_id: this.getClientId(),
            base_url: this.getBaseUrl(),
            context: null,
            expire_time: Date.now() + token.expires_in,
        };
        this._userInfo = jwt_decode(this._authInfo.access_token);
        this._updateToken();
    }

    _updateToken() {
        FS.writeFileSync(
            this.getTokenPath(),
            JSON.stringify(this._authInfo, null, 2)
        );
    }
}

module.exports = KapetaAPI;
