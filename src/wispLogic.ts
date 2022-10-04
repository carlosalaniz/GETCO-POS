import fetch from "node-fetch";
import { Response as FetchResponse } from "node-fetch";
import * as jsdom from "jsdom";

import { FileKeyValueStorage, IKeyValueStorage } from "./storage";

export interface IWispLogic {
    login(username: string, password: string): Promise<any>
    getPlans(username: string, deviceId: number, pointOfSaleName: string, cookieJar: CookieJar): Promise<Plans>
    createAccessCode(username: string, deviceId: number, plan: Plan, cookieJar: CookieJar): Promise<string>
}

//TODO: Define cookie jar type
type CookieJar = {}
export type Plan = {
    id: number,
    pointOfSale: {
        id: number,
        name: string
    },
    name: string,
    prefix: string,
    server: string
}

type Plans = {
    [planId: string]: Plan
}

export class WispHubWispLogic implements IWispLogic {
    private cookiesKey = (username: string) => `${username}-cookies`
    constructor(private keyValueStorage: IKeyValueStorage) { }
    getCsrfmiddlewaretoken(document: Document) {
        const node = document.querySelector("[name=csrfmiddlewaretoken]")
        return node && node.getAttribute("value")
    }

    parseCookies = (response) =>
        response.headers.raw()['set-cookie']
            .map((c) => c.split(';'));


    getCookieJar = (response): CookieJar =>
        (response.headers.raw()['set-cookie']) ?
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
                }, {}) : {}


    updateCookieJar(cookiesKey: string, response: FetchResponse, cookieJar: CookieJar): CookieJar {
        const responseCookieJar = this.getCookieJar(response)
        return this.keyValueStorage.write<CookieJar>(cookiesKey, { ...cookieJar, ...responseCookieJar })
    }

    cookieJarToString = (cookieMap) =>
        Object.entries(cookieMap).map(entry => `${entry[0]}=${entry[1][entry[0]]}`).join(";")



    async login(username: string, password: string): Promise<any> {
        const { JSDOM } = jsdom;
        const cookiesKey = this.cookiesKey(username)
        var cookieJar = this.keyValueStorage.read<{}>(cookiesKey);
        var requiresAuth = !cookieJar
            || !cookieJar['sessionid']
            || !cookieJar['sessionid']['expires']
            || new Date() >= new Date(cookieJar['sessionid']['expires'])
        if (requiresAuth) {
            // get csrf token
            const loginResponse = await fetch("https://cloud.co-co.mx/accounts/login/");
            const loginHtml = await loginResponse.text();
            const loginDocument = new JSDOM(loginHtml).window.document;
            const csrfToken = this.getCsrfmiddlewaretoken(loginDocument)
            const body = `csrfmiddlewaretoken=${csrfToken}` +
                `&login=${encodeURIComponent(username)}` +
                `&password=${password}` +
                `&token_device=&name_device=&type_device=&remember=1`;
            var loginPageCookies = this.getCookieJar(loginResponse)
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
            cookieJar = this.getCookieJar(doLoginResponse)
            this.keyValueStorage.write(cookiesKey, cookieJar)
        }
        return cookieJar;
    }

    async getPlans(username: string, deviceId: number, pointOfSaleName: string, cookieJar: CookieJar): Promise<Plans> {
        const { JSDOM } = jsdom;
        const cookiesKey = this.cookiesKey(username)
        const createAccessCodeResponse = await fetch(`https://cloud.co-co.mx/crear-fichas/${deviceId}/`, {
            headers: {
                "cookie": this.cookieJarToString(cookieJar)
            }
        });
        const newCookies = this.getCookieJar(createAccessCodeResponse)
        this.keyValueStorage.write(cookiesKey, { ...cookieJar, ...newCookies })
        const html = await createAccessCodeResponse.text();
        const document = new JSDOM(html).window.document;
        const plans = Array.from(document.querySelectorAll("[name=plan] option"))
            .map((n: any) => [n.text.split(" - ").map(t => t.trim()), n.value])
            .filter(n => n[0][0] === pointOfSaleName)

        const regExpStr = `(?<="username":.+"${pointOfSaleName}.+id_punto_venta":.+")\\d+`;
        const posIdExp = new RegExp(regExpStr, 'i')
        const posIdResult = html.match(posIdExp)
        if (!posIdResult || !posIdResult.length || posIdResult.length !== 1) {
            throw `${regExpStr} could not produce any matches.`
        }
        const posId = posIdResult.pop()
        const result = plans
            .reduce((acc, plan) => {
                const properties = plan[0];
                acc[plan[1]] = {
                    id: plan[1],
                    pointOfSale: {
                        id: posId,
                        name: properties[0]
                    },
                    name: properties[1],
                    prefix: properties[2].split(":")[1].trim(),
                    server: properties[3].split(":")[1].trim()
                }
                return acc
            }, {})
        return result;
    }

    async createAccessCode(username: string, deviceId: number, plan: Plan, cookieJar: CookieJar): Promise<string> {
        const { JSDOM } = jsdom;
        const cookiesKey = this.cookiesKey(username)
        // Prepare
        const createAccessFormResponse = await fetch(`https://cloud.co-co.mx/crear-fichas/${deviceId}/`, {
            headers: {
                "cookie": this.cookieJarToString(cookieJar)
            }
        });
        cookieJar = this.updateCookieJar(cookiesKey, createAccessFormResponse, cookieJar)
        const createAccessFormHtml = await createAccessFormResponse.text();
        const createAccessFormDocument = new JSDOM(createAccessFormHtml).window.document;
        const csrfToken = this.getCsrfmiddlewaretoken(createAccessFormDocument)

        // Create AccessCode
        const createAccessCodeResponse = await fetch(`https://cloud.co-co.mx/crear-fichas/${deviceId}/`, {
            headers: {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.8",
                "content-type": "application/x-www-form-urlencoded",
                "cookie": this.cookieJarToString(cookieJar)
            },
            referrer: "https://cloud.co-co.mx/crear-fichas/927/",
            referrerPolicy: "strict-origin-when-cross-origin",
            body:
                `csrfmiddlewaretoken=${csrfToken}&plan=${plan.id}&cantidad=1&punto_venta=${plan.pointOfSale.id}&imprimir=miniprinter`,
            method: "POST"
        });
        cookieJar = this.updateCookieJar(cookiesKey, createAccessCodeResponse, cookieJar)
        const createAccessCodeHtml = await createAccessCodeResponse.text();
        const createAccessCodeDocument = new JSDOM(createAccessCodeHtml).window.document;
        const taskId = createAccessCodeDocument.getElementById("task-id").getAttribute("value")

        // Wait for access code to be created.
        var taskStatus = "PROGRESS"
        var tries = 0
        while (taskStatus !== 'SUCCESS' && tries < 10) {
            const statusResponse = await fetch(`https://cloud.co-co.mx/task/${taskId}/status/`, {
                headers: {
                    "cookie": this.cookieJarToString(cookieJar)
                }
            })
            cookieJar = this.updateCookieJar(cookiesKey, createAccessCodeResponse, cookieJar)
            const responseBody = await statusResponse.json() as any
            taskStatus = responseBody.task.status
            await new Promise((resolve) => { setTimeout(() => { resolve(1) }, 500) })
        }

        if (taskStatus === 'SUCCESS') {
            const taskConfirmationResponse = await fetch(`https://cloud.co-co.mx/fichas-creadas/connecting-company/${taskId}/`, {
                redirect: "manual",
                headers: {
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    "cookie": this.cookieJarToString(cookieJar)
                },
                "method": "GET"
            });
            cookieJar = this.updateCookieJar(cookiesKey, taskConfirmationResponse, cookieJar)
            if (taskConfirmationResponse.status !== 200) {
                throw `Task confirmation replied with status=${taskConfirmationResponse.status}`
            }
            const taskConfirmationHtml = await taskConfirmationResponse.text()
            const taskConfirmationDocument = new JSDOM(taskConfirmationHtml).window.document;
            const details = Array.from(taskConfirmationDocument.querySelectorAll(".detalles p"))
                .map((p: any) => p.textContent)
                .reduce((acc, n) => {
                    const [key, value] = n.split(":").map(kv => kv.trim());
                    if (value)
                        acc[key] = value
                    return acc
                }, {})
            return details.PIN
        } else {
            throw `taskStatus=${taskStatus} is not SUCCESS`
        }
    }
}

// const wispHub = new WispHubWispLogic(new FileKeyValueStorage());

// (async () => {
//     const username = "carlos@connecting-company"
//     const password = "carloscarlos123"
//     const deviceId = 927
//     const pointOfSaleName = "3BD.02"
//     const start = +new Date()
//     console.log(`Creating new access code with username=${username} password=${password.replaceAll(/./g, '*')} deviceId=${deviceId}  pointOfSaleName=${pointOfSaleName}`)
//     const cookieJar = await wispHub.login(username, password)
//     const plans = await wispHub.getPlans(username, deviceId, pointOfSaleName, cookieJar);
//     const selectedPlan = Object.values(plans)[3];
//     console.log(`selectedPlan=${JSON.stringify(selectedPlan)}`)
//     const newAccessCode = await wispHub.createAccessCode(username, deviceId, selectedPlan, cookieJar)
//     console.log(`newAccessCode=${newAccessCode}`);
//     console.log(`time=${+new Date() - start}ms`)
// })()