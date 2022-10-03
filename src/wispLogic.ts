import fetch from "node-fetch";
import { FileKeyValueStorage, IKeyValueStorage } from "./storage";

export interface IWispLogic {
    login(username: string, password: string): Promise<any>
    createAccessCode(username: string, state: any): Promise<string>
}

//TODO: Define cookie jar type
type CookieJar = {}
export class WispHubWispLogic implements IWispLogic {
    private cookiesKey = (username: string) => `${username}-cookies`
    constructor(private keyValueStorage: IKeyValueStorage) { }

    parseCookies = (response) =>
        response.headers.raw()['set-cookie']
            .map((c) => c.split(';'));


    parseCookiesMap = (response) =>
        response.headers.raw()['set-cookie']
            .map((c) => c.split(';'))
            .reduce((acc, cookie) => {
                const cookieProperties = cookie
                    .map(properties => properties.split("="));
                acc[cookieProperties[0][0].trim()] = cookieProperties
                    .reduce((acc2, cookieProperties) => {
                        acc2[cookieProperties[0].trim()] = cookieProperties[1]
                        return acc2;
                    }, {})
                return acc;
            }, {})

    cookieJarToString = (cookieMap) =>
        Object.entries(cookieMap).map(entry => `${entry[0]}=${entry[1][entry[0]]}`).join(";")


    async login(username: string, password: string): Promise<any> {
        const cookiesKey = this.cookiesKey(username)
        var cookieJar = this.keyValueStorage.read<{}>(cookiesKey);
        var requiresAuth = !cookieJar
            || !cookieJar['sessionid']
            || !cookieJar['sessionid']['expires']
            || new Date() >= new Date(cookieJar['sessionid']['expires'])
        if (requiresAuth) {
            // get csrf token
            const loginPageResponse = await fetch("https://cloud.co-co.mx/accounts/login/");
            const text = await loginPageResponse.text()
            const regex = /(?<=csrfmiddlewaretoken' value=').+(?=')/
            const match = text.match(regex)
            if (!match) {
                throw `No CSRF found, body length = ${text.length}`
            }
            const csrfToken = match.pop()
            const body = `csrfmiddlewaretoken=${csrfToken}` +
                `&login=${encodeURIComponent(username)}` +
                `&password=${password}` +
                `&token_device=&name_device=&type_device=&remember=1`;
            var loginPageCookies = this.parseCookiesMap(loginPageResponse)
            console.log(csrfToken)
            console.log(loginPageCookies)
            const doLoginResponse = await fetch("https://cloud.co-co.mx/accounts/login/", {
                redirect: "manual",
                headers: {
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    "content-type": "application/x-www-form-urlencoded",
                    "cookie": this.cookieJarToString(loginPageCookies)
                },
                referrer: "https://cloud.co-co.mx/accounts/login/",
                referrerPolicy: "strict-origin-when-cross-origin",
                body: body,
                method: "POST"
            });
            if (doLoginResponse.status !== 302) {
                throw `status ${doLoginResponse.status} is not 304`
            }
            cookieJar = this.parseCookiesMap(doLoginResponse)
            this.keyValueStorage.write(cookiesKey, cookieJar)
        }
        return cookieJar;
    }

    async createAccessCode(username: string, cookieJar: CookieJar): Promise<string> {
        const cookiesKey = this.cookiesKey(username)
        const createAccessCodeResponse = await fetch("https://cloud.co-co.mx/crear-fichas/863/", {
            headers: {
                "cookie": this.cookieJarToString(cookieJar)
            }
        });
        const newCookies = this.parseCookiesMap(createAccessCodeResponse)
        this.keyValueStorage.write(cookiesKey, { ...cookieJar, ...newCookies })
        const text = await createAccessCodeResponse.text();
        console.log(text)
        return ""
    }

}

const wispHub = new WispHubWispLogic(new FileKeyValueStorage());

(async () => {
    const cookieJar = await wispHub.login("carlos@connecting-company", "carloscarlos123")
    const a = await wispHub.createAccessCode("carlos@connecting-company", cookieJar);
})()