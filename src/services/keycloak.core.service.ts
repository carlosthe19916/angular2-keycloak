import {Injectable, OnInit} from '@angular/core';
import {Http, Headers, RequestOptionsArgs, URLSearchParams} from '@angular/http';

import {Observable, BehaviorSubject} from 'rxjs/Rx';
import 'rxjs/operator/map';


/**
 * Keycloak core classes
 */

declare var window: any;

@Injectable()
export class Keycloak implements OnInit {

    // internal objects
    static config: any;
    static adapter: any;
    static resourceAccess: any;
    static callback_id: number = 0;
    static loginIframe: LoginIframe;
    static callbackStorage: any;
    static timeSkew: number;

    // protocol conf
    static authenticated: boolean = false;
    static initialized: boolean = false;
    static loginRequired: boolean = true;
    static responseMode: string;
    static responseType: string;

    // Token objects
    static tokenParsed: any;
    static idTokenParsed: any;
    static refreshTokenParsed: any;
    static token: string;
    static idToken: string;
    static refreshToken: string;
    static tokenTimeoutHandle: any;
    static subject: string;
    static sessionId: string;


    // OIDC client properties
    static flow: string;
    static clientId: string;
    static clientSecret: string;
    static authServerUrl: string;
    static realm: string;
    static realmAccess: any;

    // callback functions
    static onTokenExpired: any;
    static onAuthSuccess: any;
    static onAuthLogout: any;
    static onAuthError: any;

    // observers
    static initializedBehaviourSubject: BehaviorSubject<boolean> = new BehaviorSubject(false);
    static initializedObs: Observable<boolean> = Keycloak.initializedBehaviourSubject.asObservable();
    static authenticatedBehaviourSubject: BehaviorSubject<boolean> = new BehaviorSubject(false);
    static authenticatedObs: Observable<boolean> = Keycloak.authenticatedBehaviourSubject.asObservable();

    public onReady: any;

    // public constructor
    constructor(private http: Http) {
        Keycloak.loginIframe = new LoginIframe(true, [], 5);
    }

    static setAuthenticted() {
        Keycloak.authenticatedBehaviourSubject.next(true);
    }


    get tokenParsed(): any {
        return Keycloak.tokenParsed;
    }

    get authenticated(): boolean {
        return Keycloak.authenticated;
    }

    get initialized(): boolean {
        return Keycloak.initialized;
    }

    public ngOnInit() {
        console.info('initializing Keycloak');
    }

    public init(initOptions: any) {
        Keycloak.authenticated = false;

        Keycloak.callbackStorage = this.createCallbackStorage();

        if (initOptions && initOptions.adapter === 'cordova') {
            Keycloak.adapter = this.loadAdapter('cordova', this.http);
        } else if (initOptions && initOptions.adapter === 'default') {
            Keycloak.adapter = this.loadAdapter('default', this.http);
        } else {
            if (window[<any>'cordova']) {
                Keycloak.adapter = this.loadAdapter('cordova', this.http);
            } else {
                Keycloak.adapter = this.loadAdapter('default', this.http);
            }
        }


        // options processing
        if (initOptions) {
            if (typeof initOptions.checkLoginIframe !== 'undefined') {
                Keycloak.loginIframe.enable = initOptions.checkLoginIframe;
            }

            if (initOptions.checkLoginIframeInterval) {
                Keycloak.loginIframe.interval = initOptions.checkLoginIframeInterval;
            }

            if (initOptions.onLoad === 'login-required') {
                Keycloak.loginRequired = true;
            }

            if (initOptions.responseMode) {
                if (initOptions.responseMode === 'query' || initOptions.responseMode === 'fragment') {
                    Keycloak.responseMode = initOptions.responseMode;
                } else {
                    throw 'Invalid value for responseMode';
                }
            }

            if (initOptions.flow) {
                switch (initOptions.flow) {
                    case 'standard':
                        Keycloak.responseType = 'code';
                        break;
                    case 'implicit':
                        Keycloak.responseType = 'id_token token';
                        break;
                    case 'hybrid':
                        Keycloak.responseType = 'code id_token token';
                        break;
                    default:
                        throw 'Invalid value for flow';
                }
                Keycloak.flow = initOptions.flow;
            }
        }

        if (!Keycloak.responseMode) {
            Keycloak.responseMode = 'fragment';
        }
        if (!Keycloak.responseType) {
            Keycloak.responseType = 'code';
            Keycloak.flow = 'standard';
        }

        // loading keycloak conf

        this.loadConfig(Keycloak.config).subscribe(loaded => {
            if (loaded) {
                this.processInit(initOptions).subscribe(initialized => {
                    Keycloak.initializedBehaviourSubject.next(true);
                    if (this.onReady) {
                        this.onReady(Keycloak.authenticated);
                    }
                });
            }
        });
    }

    public loadConfig(url: string): Observable<boolean> {
        return new Observable<boolean>((observer: any) => {
            let configUrl: string;
            if (!Keycloak.config) {
                configUrl = 'keycloak.json';
            } else if (typeof Keycloak.config === 'string') {
                configUrl = Keycloak.config;
            }

            if (configUrl) {

                this.http.get(configUrl).map(res => res.json()).subscribe(config => {

                    Keycloak.authServerUrl = config['auth-server-url'];
                    Keycloak.realm = config['realm'];
                    Keycloak.clientId = config['resource'];
                    Keycloak.clientSecret = (config['credentials'] || {})['secret'];

                    observer.next(true);
                    // console.info("Keycloak initialized !");
                });
            } else {
                if (!Keycloak.config['url']) {
                    let scripts = document.getElementsByTagName('script');
                    for (let i = 0; i < scripts.length; i++) {
                        if (scripts[i].src.match(/.*keycloak\.js/)) {
                            Keycloak.config.url = scripts[i].src.substr(0, scripts[i].src.indexOf('/js/keycloak.js'));
                            break;
                        }
                    }
                }

                if (!Keycloak.config.realm) {
                    throw 'realm missing';
                }

                if (!Keycloak.config.clientId) {
                    throw 'clientId missing';
                }

                Keycloak.authServerUrl = Keycloak.config.url;
                Keycloak.realm = Keycloak.config.realm;
                Keycloak.clientId = Keycloak.config.clientId;
                Keycloak.clientSecret = (Keycloak.config.credentials || {}).secret;
                observer.next(true);
            }
        });
    }


    public processInit(initOptions: any): Observable<boolean> {
        return new Observable<boolean>((observer: any) => {

            let callback = Keycloak.parseCallback(window.location.href);
            let initPromise: any = Keycloak.createPromise;

            if (callback) {
                this.setupCheckLoginIframe();
                window.history.replaceState({}, null, callback.newUrl);
                Keycloak.processCallback(callback, initPromise, this.http);
                return;
            } else if (initOptions) {
                if (initOptions.token || initOptions.refreshToken) {
                    Keycloak.setToken(initOptions.token, initOptions.refreshToken, initOptions.idToken, false);
                    Keycloak.timeSkew = initOptions.timeSkew || 0;

                    if (Keycloak.loginIframe.enable) {
                        this.setupCheckLoginIframe().success(function () {
                            this.checkLoginIframe().success(function () {
                                this.initPromise.setSuccess();
                            }).error(function () {
                                if (initOptions.onLoad) {
                                    this.onLoad(initOptions);
                                }
                            });
                        });
                    } else {
                        observer.next(true);
                    }
                } else if (initOptions.onLoad) {
                    this.onLoad(initOptions);
                } else {
                    observer.next(true);
                }
            } else {
                observer.next(true);
            }
        });
    }


    public onLoad(initOptions: any) {
        let options: any = {};
        let doLogin = function (prompt: any) {
            if (!prompt) {
                options.prompt = 'none';
            }
            this.login(options).success(function () {
                this.initPromise.setSuccess();
            }).error(function () {
                this.initPromise.setError();
            });
        };


        switch (initOptions.onLoad) {
            case 'check-sso':
                if (Keycloak.loginIframe.enable) {
                    this.setupCheckLoginIframe().success(function () {
                        this.checkLoginIframe().success(function () {
                            this.doLogin(false);
                        }).error(function () {
                            this.initPromise.setSuccess();
                        });
                    });
                } else {
                    doLogin(false);
                }
                break;
            case 'login-required':
                doLogin(true);
                break;
            default:
                throw 'Invalid value for onLoad';
        }
    }


    static login(options: any) {
        return Keycloak.adapter.login(options);
    }

    static createLoginUrl(options: any): string {
        let state = Keycloak.createUUID();
        let nonce = Keycloak.createUUID();

        let redirectUri = Keycloak.adapter.redirectUri(options);
        if (options && options.prompt) {
            redirectUri += (redirectUri.indexOf('?') === -1 ? '?' : '&') + 'prompt=' + options.prompt;
        }

        Keycloak.callbackStorage.add({state: state, nonce: nonce, redirectUri: redirectUri});

        let action = 'auth';
        if (options && options.action === 'register') {
            action = 'registrations';
        }

        let scope = (options && options.scope) ? 'openid ' + options.scope : 'openid';

        let url = Keycloak.getRealmUrl()
            + '/protocol/openid-connect/' + action
            + '?client_id=' + encodeURIComponent(Keycloak.clientId)
            + '&redirect_uri=' + encodeURIComponent(redirectUri)
            + '&state=' + encodeURIComponent(state)
            + '&nonce=' + encodeURIComponent(nonce)
            + '&response_mode=' + encodeURIComponent(Keycloak.responseMode)
            + '&response_type=' + encodeURIComponent(Keycloak.responseType)
            + '&scope=' + encodeURIComponent(scope);

        if (options && options.prompt) {
            url += '&prompt=' + encodeURIComponent(options.prompt);
        }

        if (options && options.maxAge) {
            url += '&max_age=' + encodeURIComponent(options.maxAge);
        }

        if (options && options.loginHint) {
            url += '&login_hint=' + encodeURIComponent(options.loginHint);
        }

        if (options && options.idpHint) {
            url += '&kc_idp_hint=' + encodeURIComponent(options.idpHint);
        }

        if (options && options.locale) {
            url += '&ui_locales=' + encodeURIComponent(options.locale);
        }

        return url;
    }

    public logout(options: any) {
        return Keycloak.adapter.logout(options);
    }

    static createLogoutUrl(options: any): string {
        let url = Keycloak.getRealmUrl()
            + '/protocol/openid-connect/logout'
            + '?redirect_uri=' + encodeURIComponent(Keycloak.adapter.redirectUri(options, false));

        return url;
    }

    public register(options: any) {
        return Keycloak.adapter.register(options);
    }

    static createRegisterUrl(options: any): string {
        if (!options) {
            options = {};
        }
        options.action = 'register';
        return Keycloak.createLoginUrl(options);
    }

    static createAccountUrl(options: any): string {
        let url = Keycloak.getRealmUrl()
            + '/account'
            + '?referrer=' + encodeURIComponent(Keycloak.clientId)
            + '&referrer_uri=' + encodeURIComponent(Keycloak.adapter.redirectUri(options));

        return url;
    }

    public accountManagement() {
        return Keycloak.adapter.accountManagement();
    }

    public hasRealmRole(role: string): boolean {
        let access = Keycloak.realmAccess;
        return !!access && access.roles.indexOf(role) >= 0;
    }

    public hasResourceRole(role: string, resource: string): boolean {
        if (!Keycloak.resourceAccess) {
            return false;
        }

        let access: any = Keycloak.resourceAccess[resource || Keycloak.clientId];
        return !!access && access.roles.indexOf(role) >= 0;
    }

    public loadUserProfile(): Observable<any> {
        let url = Keycloak.getRealmUrl() + '/account';
        let headers = new Headers({'Accept': 'application/json', 'Authorization': 'bearer ' + Keycloak.token});

        let options: RequestOptionsArgs = {headers: headers};
        return this.http.get(url, options).map(profile => profile.json());
    }

    public loadUserInfo(): Observable<any> {
        let url = Keycloak.getRealmUrl() + '/protocol/openid-connect/userinfo';
        let headers = new Headers({'Accept': 'application/json', 'Authorization': 'bearer ' + Keycloak.token});

        let options: RequestOptionsArgs = {headers: headers};
        return this.http.get(url, options).map(profile => profile);
    }

    static isTokenExpired(minValidity: number): boolean {
        if (!Keycloak.tokenParsed || (!Keycloak.refreshToken && Keycloak.flow !== 'implicit' )) {
            throw 'Not authenticated';
        }

        let expiresIn = Keycloak.tokenParsed['exp'] - (new Date().getTime() / 1000) + Keycloak.timeSkew;
        if (minValidity) {
            expiresIn -= minValidity;
        }

        return expiresIn < 0;
    }

    static isRefreshTokenExpired(minValidity: number): boolean {
        if (!Keycloak.tokenParsed || (!Keycloak.refreshToken && Keycloak.flow !== 'implicit' )) {
            throw 'Not authenticated';
        }

        let expiresIn = Keycloak.refreshTokenParsed['exp'] - (new Date().getTime() / 1000) + Keycloak.timeSkew;
        if (minValidity) {
            expiresIn -= minValidity;
        }

        return expiresIn < 0;
    }

    public updateTokenPub(minValidity: number): Observable<string> {
        return Keycloak.updateToken(minValidity, this.http);
    }

    static updateToken(minValidity: number, http: Http): Observable<string> {

        return new Observable<string>((observer: any) => {

            // if (!Keycloak.tokenParsed || !Keycloak.refreshToken) {
            //   observer.next(false);
            // }
            minValidity = minValidity || 5;


            if (!Keycloak.isTokenExpired(minValidity)) {
                console.info('token still valid');
                observer.next(Keycloak.token);
            } else {
                if (Keycloak.isRefreshTokenExpired(5)) {
                    Keycloak.login(Keycloak.config);
                } else {
                    console.info('refreshing token');
                    let params: URLSearchParams = new URLSearchParams();
                    params.set('grant_type', 'refresh_token');
                    params.set('refresh_token', Keycloak.refreshToken);

                    let url = Keycloak.getRealmUrl() + '/protocol/openid-connect/token';
                    console.info('getting url');
                    let headers = new Headers({'Content-type': 'application/x-www-form-urlencoded'});

                    if (Keycloak.clientId && Keycloak.clientSecret) {
                        headers.append('Authorization', 'Basic ' + btoa(Keycloak.clientId + ': ' + Keycloak.clientSecret));
                    } else {
                        params.set('client_id', this.clientId);
                        // params += '&client_id=' + encodeURIComponent(this.clientId);
                    }

                    let timeLocal = new Date().getTime();

                    let options: RequestOptionsArgs = {headers: headers, withCredentials: true};
                    console.info('calling url ' + url);
                    http.post(url, params, options).subscribe((token: any) => {
                        timeLocal = (timeLocal + new Date().getTime()) / 2;

                        let tokenResponse = token.json();
                        console.info('parsed access token ' + tokenResponse['access_token']);
                        Keycloak.setToken(tokenResponse['access_token'], tokenResponse['refresh_token'], tokenResponse['id_token'], true);

                        Keycloak.timeSkew = Math.floor(timeLocal / 1000) - Keycloak.tokenParsed.iat;
                        observer.next(tokenResponse['access_token']);

                    });
                }
            }
        });
    }

    static clearToken(initOptions: any) {
        if (Keycloak.token) {
            Keycloak.setToken(null, null, null, true);
            Keycloak.onAuthLogout && Keycloak.onAuthLogout();
            if (Keycloak.loginRequired) {
                Keycloak.login(initOptions);
            }
        }
    }

    static getRealmUrl(): string {
        if (Keycloak.authServerUrl.charAt(Keycloak.authServerUrl.length - 1) === '/') {
            return Keycloak.authServerUrl + 'realms/' + encodeURIComponent(Keycloak.realm);
        } else {
            return Keycloak.authServerUrl + '/realms/' + encodeURIComponent(Keycloak.realm);
        }
    }

    public getOrigin(): string {
        if (!window.location.origin) {
            return window.location.protocol + '//' + window.location.hostname + (window.location.port ? ': ' + window.location.port : '');
        } else {
            return window.location.origin;
        }
    }

    static processCallback(oauth: any, promise: any, http: Http) {
        let code = oauth.code;
        let error = oauth.error;
        let prompt = oauth.prompt;
        let timeLocal = new Date().getTime();

        if (error) {
            if (prompt !== 'none') {
                let errorData = {error: error, error_description: oauth.error_description};
                Keycloak.onAuthError && Keycloak.onAuthError(errorData);
                promise && promise.setError(errorData);
            } else {
                promise && promise.setSuccess();
            }
            return;
        } else if ((Keycloak.flow !== 'standard') && (oauth.access_token || oauth.id_token)) {
            authSuccess(oauth.access_token, null, oauth.id_token, true);
        }

        if ((Keycloak.flow !== 'implicit') && code) {

            let url = Keycloak.getRealmUrl() + '/protocol/openid-connect/token';
            let params: URLSearchParams = new URLSearchParams();
            params.set('code', code);
            params.set('grant_type', 'authorization_code');

            let headers = new Headers({'Content-type': 'application/x-www-form-urlencoded'});

            if (Keycloak.clientId && Keycloak.clientSecret) {
                headers.append('Authorization', 'Basic ' + btoa(Keycloak.clientId + ':' + Keycloak.clientSecret));
            } else {
                params.set('client_id', Keycloak.clientId);
            }
            params.set('redirect_uri', oauth.redirectUri);
            let options: RequestOptionsArgs = {headers: headers, withCredentials: true};

            http.post(url, params, options).subscribe(token => {
                let tokenResponse = token.json();
                authSuccess(
                    tokenResponse['access_token'],
                    tokenResponse['refresh_token'],
                    tokenResponse['id_token'],
                    Keycloak.flow === 'standard');
            });
        }

        function authSuccess(accessToken: string, refreshToken: string, idToken: string, fulfillPromise: any) {
            timeLocal = (timeLocal + new Date().getTime()) / 2;

            Keycloak.setToken(accessToken, refreshToken, idToken, true);

            if ((Keycloak.tokenParsed && Keycloak.tokenParsed.nonce !== oauth.storedNonce) ||
                (Keycloak.refreshTokenParsed && Keycloak.refreshTokenParsed.nonce !== oauth.storedNonce) ||
                (Keycloak.idTokenParsed && Keycloak.idTokenParsed.nonce !== oauth.storedNonce)) {

                console.log('invalid nonce!');
                Keycloak.clearToken({});

            } else {
                Keycloak.timeSkew = Math.floor(timeLocal / 1000) - Keycloak.tokenParsed.iat;

                if (fulfillPromise) {
                    Keycloak.onAuthSuccess && Keycloak.onAuthSuccess();
                }
            }
        }
    }


    static setToken(token: string, refreshToken: string, idToken: string, useTokenTime: boolean) {
        if (Keycloak.tokenTimeoutHandle) {
            clearTimeout(Keycloak.tokenTimeoutHandle);
            Keycloak.tokenTimeoutHandle = null;
        }

        if (token) {
            Keycloak.token = token;
            Keycloak.tokenParsed = Keycloak.decodeToken(token);
            let sessionId = Keycloak.realm + '/' + Keycloak.tokenParsed.sub;
            if (Keycloak.tokenParsed.session_state) {
                sessionId = sessionId + '/' + Keycloak.tokenParsed.session_state;
            }
            Keycloak.sessionId = sessionId;
            Keycloak.authenticated = true;
            Keycloak.authenticatedBehaviourSubject.next(true);
            Keycloak.subject = Keycloak.tokenParsed.sub;
            Keycloak.realmAccess = Keycloak.tokenParsed.realm_access;
            Keycloak.resourceAccess = Keycloak.tokenParsed.resource_access;


            if (Keycloak.onTokenExpired) {
                let start = useTokenTime ? Keycloak.tokenParsed.iat : (new Date().getTime() / 1000);
                let expiresIn = Keycloak.tokenParsed.exp - start;
                Keycloak.tokenTimeoutHandle = setTimeout(Keycloak.onTokenExpired, expiresIn * 1000);
            }

        } else {
            delete Keycloak.token;
            delete Keycloak.tokenParsed;
            delete Keycloak.subject;
            delete Keycloak.realmAccess;
            delete Keycloak.resourceAccess;

            Keycloak.authenticated = false;
        }

        if (refreshToken) {
            Keycloak.refreshToken = refreshToken;
            Keycloak.refreshTokenParsed = Keycloak.decodeToken(refreshToken);
        } else {
            delete Keycloak.refreshToken;
            delete Keycloak.refreshTokenParsed;
        }

        if (idToken) {
            Keycloak.idToken = idToken;
            Keycloak.idTokenParsed = Keycloak.decodeToken(idToken);
        } else {
            delete Keycloak.idToken;
            delete Keycloak.idTokenParsed;
        }
    }

    static decodeToken(str: string): string {
        str = str.split('.')[1];

        str = str.replace('/-/g', '+');
        str = str.replace('/_/g', '/');
        switch (str.length % 4) {
            case 0:
                break;
            case 2:
                str += '==';
                break;
            case 3:
                str += '=';
                break;
            default:
                throw 'Invalid token';
        }

        str = (str + '===').slice(0, str.length + (str.length % 4));
        str = str.replace(/-/g, '+').replace(/_/g, '/');

        str = decodeURIComponent(atob(str));

        str = JSON.parse(str);
        return str;
    }

    static createUUID(): string {
        let s: any = [];
        let hexDigits = '0123456789abcdef';
        for (let i = 0; i < 36; i++) {
            s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
        }
        s[14] = '4';
        s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1);
        s[8] = s[13] = s[18] = s[23] = '-';
        let uuid = s.join('');
        return uuid;
    }


    static createCallbackId(): string {
        let id = '<id: ' + (Keycloak.callback_id++) + (Math.random()) + '>';
        return id;
    }

    static parseCallback(url: string): any {
        let oauth: any = CallbackParser.parseUri(url, Keycloak.responseMode);
        let state: string = oauth.state;
        let oauthState = Keycloak.callbackStorage.get(state);

        if (oauthState && (oauth.code || oauth.error || oauth.access_token || oauth.id_token)) {
            oauth.redirectUri = oauthState.redirectUri;
            oauth.storedNonce = oauthState.nonce;

            if (oauth.fragment) {
                oauth.newUrl += '#' + oauth.fragment;
            }

            return oauth;
        }
    }

    static createPromise() {
        let p: any = {
            setSuccess: function (result: any) {
                p.success = <any>true;
                p.result = result;
                if (p.successCallback) {
                    p.successCallback(result);
                }
            },

            setError: function (result: any) {
                p.error = true;
                p.result = result;
                if (p.errorCallback) {
                    p.errorCallback(result);
                }
            },

            promise: {
                success: function (callback: any) {
                    if (p.success) {
                        callback(p.result);
                    } else if (!p.error) {
                        p.successCallback = callback;
                    }
                    return p.promise;
                },
                error: function (callback: any) {
                    if (p.error) {
                        callback(p.result);
                    } else if (!p.success) {
                        p.errorCallback = callback;
                    }
                    return p.promise;
                }
            }
        };
        return p;
    }

    public setupCheckLoginIframe() {
        let promise = Keycloak.createPromise();

        if (!Keycloak.loginIframe.enable) {
            promise.setSuccess();
            return promise.promise;
        }

        if (Keycloak.loginIframe.iframe) {
            promise.setSuccess();
            return promise.promise;
        }

        let iframe: any = document.createElement('iframe');
        Keycloak.loginIframe.iframe = iframe;

        let check = function () {
            Keycloak.checkLoginIframe();
            if (Keycloak.token) {
                setTimeout(check, Keycloak.loginIframe.interval * 1000);
            }
        };

        iframe.onload = function () {
            let realmUrl = Keycloak.getRealmUrl();
            if (realmUrl.charAt(0) === '/') {
                Keycloak.loginIframe.iframeOrigin = this.getOrigin();
            } else {
                Keycloak.loginIframe.iframeOrigin = realmUrl.substring(0, realmUrl.indexOf('/', 8));
            }
            promise.setSuccess();

            setTimeout(check, Keycloak.loginIframe.interval * 1000);
        };
        console.info('reloading iframe...' + Keycloak.clientId + ' : ' + this.getOrigin());
        let src = Keycloak.getRealmUrl() + '/protocol/openid-connect/login-status-iframe.html';

        console.info('reloading iframe...' + src);
        iframe.setAttribute('src', src);
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        let messageCallback = function (event: any) {

            if (event.origin !== iframe.iframeOrigin) {
                return;
            }

            if (event.data !== 'unchanged') {
                Keycloak.clearToken({});
            }

            let callbacks = iframe.callbackMap[Keycloak.clientId].splice(0, iframe.callbackList.length);

            for (let i = callbacks.length - 1; i >= 0; --i) {
                promise = callbacks[i];
                if (event.data === 'unchanged') {
                    promise.setSuccess();
                } else {
                    promise.setError();
                }
            }
        };
        window.addEventListener('message', messageCallback, false);

        return promise.promise;
    }

    static checkLoginIframe() {
        let promise = Keycloak.createPromise();

        if (Keycloak.loginIframe.iframe && Keycloak.loginIframe.iframeOrigin) {

            let msg = Keycloak.clientId + ' ' + Keycloak.sessionId;
            Keycloak.loginIframe.callbackMap[Keycloak.clientId] = promise;
            let origin = Keycloak.loginIframe.iframeOrigin;
            Keycloak.loginIframe.iframe.contentWindow.postMessage(msg, origin);
        } else {
            promise.setSuccess();
        }

        return promise.promise;
    }

    public loadAdapter(type: string, http: Http): any {
        if (!type || type === 'default') {

            return new DefaultAdapter();
        }

        if (type === 'cordova') {
            Keycloak.loginIframe.enable = false;

            return {
                login: function (options: any) {
                    let promise = Keycloak.createPromise();

                    let o = 'location=no';
                    if (options && options.prompt === 'none') {
                        o += ',hidden=yes';
                    }

                    let loginUrl = Keycloak.createLoginUrl(options);

                    console.info('opening login frame from cordova: ' + loginUrl);
                    if (!window.cordova) {
                        throw new Error('Cannot authenticate via a web browser');
                    }

                    if (!window.cordova.InAppBrowser) {
                        throw new Error('The Apache Cordova InAppBrowser plugin was not found and is required');
                    }

                    let ref = window.cordova.InAppBrowser.open(loginUrl, '_blank', o);

                    let completed = false;

                    ref.addEventListener('loadstart', function (event: any) {
                        if (event.url.indexOf('http://localhost') === 0) {
                            let callback = Keycloak.parseCallback(event.url);
                            Keycloak.processCallback(callback, promise, http);
                            ref.close();
                            completed = true;
                        }
                    });

                    ref.addEventListener('loaderror', function (event: any) {
                        if (!completed) {
                            if (event.url.indexOf('http://localhost') === 0) {
                                console.log('login done');
                                let callback = Keycloak.parseCallback(event.url);
                                Keycloak.processCallback(callback, promise, this.http);
                                ref.close();
                                completed = true;
                            } else {
                                promise.setError();
                                ref.close();
                            }
                        }
                    });

                    return promise.promise;
                },

                logout: function (options: any) {
                    let promise = Keycloak.createPromise();

                    let logoutUrl = Keycloak.createLogoutUrl(options);
                    let ref = window.open(logoutUrl, '_blank', 'location=no,hidden=yes');

                    let error: any;

                    ref.addEventListener('loadstart', function (event: any) {
                        if (event.url.indexOf('http://localhost') === 0) {
                            ref.close();
                        }
                    });

                    ref.addEventListener('loaderror', function (event: any) {
                        if (event.url.indexOf('http://localhost') === 0) {
                            ref.close();
                        } else {
                            error = true;
                            ref.close();
                        }
                    });

                    ref.addEventListener('exit', function (event: any) {
                        if (error) {
                            promise.setError();
                        } else {
                            Keycloak.clearToken({});
                            promise.setSuccess();
                        }
                    });

                    return promise.promise;
                },

                register: function () {
                    let registerUrl = this.createRegisterUrl();
                    let ref = window.open(registerUrl, '_blank', 'location=no');
                    ref.addEventListener('loadstart', function (event: any) {
                        if (event.url.indexOf('http://localhost') === 0) {
                            ref.close();
                        }
                    });
                },

                accountManagement: function () {
                    let accountUrl = this.createAccountUrl();
                    let ref = window.open(accountUrl, '_blank', 'location=no');
                    ref.addEventListener('loadstart', function (event: any) {
                        if (event.url.indexOf('http://localhost') === 0) {
                            ref.close();
                        }
                    });
                },

                redirectUri: function (options: any): any {
                    return 'http://localhost';
                }
            };
        }

        throw 'invalid adapter type: ' + type;
    }


    public createCallbackStorage(): any {
        try {
            return new LocalStorage();
        } catch (err) {
        }

        return new CookieStorage();
    }

}

export class DefaultAdapter {


    constructor() {

    }

    public login(options: any) {
        window.location.href = Keycloak.createLoginUrl(options);

    }

    public logout(options: any) {
        window.location.href = Keycloak.createLogoutUrl(options);

    }

    public register(options: any) {
        window.location.href = Keycloak.createRegisterUrl(options);
    }

    public accountManagement() {
        window.location.href = Keycloak.createAccountUrl({});

    }

    public redirectUri(options: any, encodeHash: boolean): string {

        if (arguments.length === 1) {
            encodeHash = true;
        }

        if (options && options.redirectUri) {
            return options.redirectUri;
        } else {
            let redirectUri = location.href;
            if (location.hash && encodeHash) {
                redirectUri = redirectUri.substring(0, location.href.indexOf('#'));
                redirectUri += (redirectUri.indexOf('?') === -1 ? '?' : '&') + 'redirect_fragment=' +
                    encodeURIComponent(location.hash.substring(1));
            }
            return redirectUri;
        }
    }
}


export class LoginIframe {
    public iframe: any;
    public iframeOrigin: any;

    constructor(public enable: boolean, public callbackMap: any, public interval: number) {

    }
}

export class LocalStorage {

    public clearExpired() {
        let time = new Date().getTime();
        for (let i = 1; i <= localStorage.length; i++) {
            let key = localStorage.key(i);
            if (key && key.indexOf('kc-callback-') === 0) {
                let value = localStorage.getItem(key);
                if (value) {
                    try {
                        let expires = JSON.parse(value).expires;
                        if (!expires || expires < time) {
                            localStorage.removeItem(key);
                        }
                    } catch (err) {
                        localStorage.removeItem(key);
                    }
                }
            }
        }
    }

    public get(state: string) {
        if (!state) {
            return;
        }

        let key = 'kc-callback-' + state;
        let value = localStorage.getItem(key);
        if (value) {
            localStorage.removeItem(key);
            value = JSON.parse(value);
        }

        this.clearExpired();
        return value;
    };

    public add(state: any) {
        this.clearExpired();

        let key = 'kc-callback-' + state.state;
        state.expires = new Date().getTime() + (60 * 60 * 1000);
        localStorage.setItem(key, JSON.stringify(state));
    };
}

export class CookieStorage {

    public get(state: string) {
        if (!state) {
            return;
        }

        let value = this.getCookie('kc-callback-' + state);
        this.setCookie('kc-callback-' + state, '', this.cookieExpiration(-100));
        if (value) {
            return JSON.parse(value);
        }
    };

    public add(state: any) {
        this.setCookie('kc-callback-' + state.state, JSON.stringify(state), this.cookieExpiration(60));
    };

    public removeItem(key: any) {
        this.setCookie(key, '', this.cookieExpiration(-100));
    };

    public cookieExpiration(minutes: number) {
        let exp = new Date();
        exp.setTime(exp.getTime() + (minutes * 60 * 1000));
        return exp;
    };

    public getCookie = function (key: any) {
        let name = key + '=';
        let ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) === 0) {
                return c.substring(name.length, c.length);
            }
        }
        return '';
    };

    public setCookie(key: string, value: string, expirationDate: Date) {
        let cookie = key + '=' + value + '; '
            + 'expires=' + expirationDate.toUTCString() + '; ';
        document.cookie = cookie;
    }
}
;


export class CallbackParser {

    static initialParse(uriToParse: string, responseMode: string) {
        let baseUri: string;
        let queryString: string;
        let fragmentString: string;

        let questionMarkIndex = uriToParse.indexOf('?');
        let fragmentIndex = uriToParse.indexOf('#', questionMarkIndex + 1);
        if (questionMarkIndex === -1 && fragmentIndex === -1) {
            baseUri = uriToParse;
        } else if (questionMarkIndex !== -1) {
            baseUri = uriToParse.substring(0, questionMarkIndex);
            queryString = uriToParse.substring(questionMarkIndex + 1);
            if (fragmentIndex !== -1) {
                fragmentIndex = queryString.indexOf('#');
                fragmentString = queryString.substring(fragmentIndex + 1);
                queryString = queryString.substring(0, fragmentIndex);
            }
        } else {
            baseUri = uriToParse.substring(0, fragmentIndex);
            fragmentString = uriToParse.substring(fragmentIndex + 1);
        }

        return {baseUri: baseUri, queryString: queryString, fragmentString: fragmentString};
    }

    static parseParams(paramString: string) {
        let result: any = {};
        let params = paramString.split('&');
        for (let i = 0; i < params.length; i++) {
            let p = params[i].split('=');
            let paramName = decodeURIComponent(p[0]);
            let paramValue = decodeURIComponent(p[1]);
            result[paramName] = paramValue;
        }
        return result;
    }

    static handleQueryParam(paramName: string, paramValue: string, oauth: any): boolean {
        let supportedOAuthParams = ['code', 'state', 'error', 'error_description'];

        for (let i = 0; i < supportedOAuthParams.length; i++) {
            if (paramName === supportedOAuthParams[i]) {
                oauth[paramName] = paramValue;
                return true;
            }
        }
        return false;
    }


    static parseUri(uriToParse: string, responseMode: string) {
        let parsedUri = CallbackParser.initialParse(decodeURIComponent(uriToParse), responseMode);

        let queryParams: any = {};
        if (parsedUri.queryString) {
            queryParams = CallbackParser.parseParams(parsedUri.queryString);
        }

        let oauth: any = {newUrl: parsedUri.baseUri};
        for (let param in queryParams) {
            switch (param) {
                case 'redirect_fragment':
                    oauth.fragment = queryParams[param];
                    break;
                case 'prompt':
                    oauth.prompt = queryParams[param];
                    break;
                default:
                    if (responseMode !== 'query' || !CallbackParser.handleQueryParam(param, queryParams[param], oauth)) {
                        oauth.newUrl += (oauth.newUrl.indexOf('?') === -1 ? '?' : '&') + param + '=' + queryParams[param];
                    }
                    break;
            }
        }

        if (responseMode === 'fragment') {
            let fragmentParams: any = {};
            if (parsedUri.fragmentString) {
                fragmentParams = CallbackParser.parseParams(parsedUri.fragmentString);
            }
            for (let param in fragmentParams) {
                oauth[param] = fragmentParams[param];
            }
        }
        return oauth;
    }
}
