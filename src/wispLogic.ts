import fetch from "node-fetch";
import { Response as FetchResponse } from "node-fetch";
import * as jsdom from "jsdom";
import * as tabletojson from 'tabletojson';

import { FileKeyValueStorage, IKeyValueStorage } from "./storage";

export interface IWispLogic {
    login(username: string, password: string): Promise<any>
    getPlans(pointOfSaleName: string): Promise<Plans>
    createAccessCode(username: string, plan: Plan, pointOfSaleName: string, cookieJar: CookieJar): Promise<{}>
}

//TODO: Define cookie jar type
export type CookieJar = {}
type PlanExtras = {
    plan: string,
    planLongName: string,
    price: string,
    currency: string,
    router: string
}

export type Plan = {
    id: number,
    routerShortName: string,
    pointOfSale: {
        id: number,
        name: string
    }[],
    name: string,
    prefix: string
} & PlanExtras

type Plans = {
    [planId: string]: Plan
}

type PlanPointOfSaleMap = {
    [planId: string]: { username: string, id_punto_venta: string }[]
}



export class WispHubWispLogic implements IWispLogic {

    private cookiesKey = (username: string) => `${username}-cookies`
    private pointsOfSaleKey = "WISP_HUB_POINTS_OF_SALE";
    private plansKey = "WISP_HUB_PLANS";
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

    async getPlanPointOfSaleMap(username: string, cookieJar: CookieJar) {
        const cookiesKey = this.cookiesKey(username)
        const pointsOfSaleRegex = /(?<=var planes =.+)\{.+(?=;)/i
        const createAccessCodeResponse = await fetch(`https://cloud.co-co.mx/crear-fichas`, {
            headers: {
                "cookie": this.cookieJarToString(cookieJar)
            }
        });
        cookieJar = this.updateCookieJar(cookiesKey, createAccessCodeResponse, cookieJar)
        const html = await createAccessCodeResponse.text();
        const posMatch = html.match(pointsOfSaleRegex);
        if (!posMatch) throw `No match for ${pointsOfSaleRegex}`
        const planPointOfSaleMap = JSON.parse(posMatch[0]) as PlanPointOfSaleMap;
        return planPointOfSaleMap;
    }

    async refreshPlans(username: string, cookieJar: CookieJar) {
        const { JSDOM } = jsdom;
        const cookiesKey = this.cookiesKey(username)
        const plansResponse = await fetch("https://cloud.co-co.mx/fichas-plan/", {
            headers: {
                "cookie": this.cookieJarToString(cookieJar)
            }
        })
        this.updateCookieJar(cookiesKey, plansResponse, cookieJar)
        const html = await plansResponse.text();
        const document = new JSDOM(html).window.document;
        const plansTableElement = document.querySelector("#data-table-prefijos")
        plansTableElement.querySelector("tfoot").remove()
        const plansDataRaw = tabletojson.Tabletojson.convert(plansTableElement.outerHTML).at(0)
        if (!plansDataRaw) throw `Cant parse plans data`
        if (!Array.isArray(plansDataRaw)) throw 'plans data is not an array'
        if (plansDataRaw.length === 0) throw 'Plans data should not be 0'
        const plansExtras = plansDataRaw.map(plan => {
            return {
                plan: plan.Plan,
                planLongName: plan.Prefijo,
                price: plan.Costo,
                currency: 'MXN',
                router: plan.Router,
            } as PlanExtras
        })
        // Get plan Id
        const createAccessCodeResponse = await fetch(`https://cloud.co-co.mx/crear-fichas`, {
            headers: {
                "cookie": this.cookieJarToString(cookieJar)
            }
        });
        cookieJar = this.updateCookieJar(cookiesKey, createAccessCodeResponse, cookieJar)
        const formHtml = await createAccessCodeResponse.text();
        const formDocument = new JSDOM(formHtml).window.document;
        const formPlans = Array.from(formDocument.querySelectorAll("[name=plan] option"))
            .map((n: any) => [n.text.split(" - ").map(t => t.trim()), n.value])
            .filter(fp => fp[1] && fp[1].length > 0)
        const getPlanPointOfSaleMap = await this.getPlanPointOfSaleMap(username, cookieJar)

        const plans: Plans = formPlans
            .reduce((acc, plan) => {
                const properties = plan[0];
                const pos = getPlanPointOfSaleMap[plan[1]]
                const partialPlan = {
                    id: plan[1],
                    routerShortName: properties[0],
                    pointOfSale: pos.map(p => {
                        return {
                            id: +p.id_punto_venta,
                            name: p.username
                        }
                    }),
                    name: properties[1],
                    prefix: properties[2].split(":")[1].trim()
                } as Partial<Plan>
                const extrasRegex = new RegExp(`${partialPlan.routerShortName}.+${partialPlan.name} .+${partialPlan.prefix}`)
                const planExtraData = plansExtras.filter(pExtras => extrasRegex.test(pExtras.planLongName)).at(0)
                acc[plan[1]] = { ...partialPlan, ...planExtraData } as Plan
                return acc
            }, {})

        this.keyValueStorage.write<Plans>(
            this.plansKey,
            plans
        );

        return plans;
    }

    async getPlans(pointOfSaleName: string): Promise<Plans> {
        const plans = this.keyValueStorage.read<Plans>(this.plansKey);
        const filteredEntries = Object.entries(plans).filter((entry) => {
            return entry[1].pointOfSale.findIndex(pos => pos.name === pointOfSaleName) >= 0
        })
        return Object.fromEntries(filteredEntries)
    }

    async createAccessCode(username: string, plan: Plan, pointOfSaleName: string, cookieJar: CookieJar): Promise<{}> {
        const { JSDOM } = jsdom;
        const cookiesKey = this.cookiesKey(username)
        // Prepare
        const createAccessFormResponse = await fetch(`https://cloud.co-co.mx/crear-fichas/`, {
            headers: {
                "cookie": this.cookieJarToString(cookieJar)
            }
        });
        cookieJar = this.updateCookieJar(cookiesKey, createAccessFormResponse, cookieJar)
        const createAccessFormHtml = await createAccessFormResponse.text();
        const createAccessFormDocument = new JSDOM(createAccessFormHtml).window.document;
        const csrfToken = this.getCsrfmiddlewaretoken(createAccessFormDocument)

        // Create AccessCode
        const pos = plan.pointOfSale.find(pos => pos.name === pointOfSaleName)
        const createAccessCodeResponse = await fetch(`https://cloud.co-co.mx/crear-fichas/`, {
            headers: {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.8",
                "content-type": "application/x-www-form-urlencoded",
                "cookie": this.cookieJarToString(cookieJar),
                "Referer": "https://cloud.co-co.mx/crear-fichas/",
                "Referrer-Policy": "strict-origin-when-cross-origin"
            },
            referrerPolicy: "strict-origin-when-cross-origin",
            body:
                `csrfmiddlewaretoken=${csrfToken}&plan=${plan.id}&cantidad=1&punto_venta=&imprimir=miniprinter`,
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
            const loginURLRegExp = new RegExp('(?<=qr/\\?text=).+(?=" width)')
            const loginURLMatch = taskConfirmationHtml.match(loginURLRegExp);
            const loginUrl = loginURLMatch && loginURLMatch[0];
            const details = Array.from(taskConfirmationDocument.querySelectorAll(".detalles p"))
                .map((p: any) => p.textContent)
                .reduce((acc, n) => {
                    const [key, value] = n.split(":").map(kv => kv.trim());
                    if (value)
                        acc[key] = value
                    else if (key.includes('$')) {
                        acc["Costo"] = key
                    }
                    return acc
                }, {})
            return { ...details, loginUrl }
        } else {
            throw `taskStatus=${taskStatus} is not SUCCESS`
        }
    }

    private parseDate(dateString: string): Date {
        const match = dateString.match(/^(\d\d?)\/(\d\d?)\/(\d{4}) (\d{2}):(\d{2})/)
        return match && match.slice(1)
            .reduce((accDate, value, index) => {
                switch (index) {
                    case 0:
                        // day
                        accDate.setDate(+value)
                        break;
                    case 1:
                        accDate.setMonth(+value - 1)
                        // month
                        break;
                    case 2:
                        // year
                        accDate.setFullYear(+value)
                        break;
                    case 3:
                        // hours
                        accDate.setHours(+value)
                        break;
                    case 4:
                        // minutes
                        accDate.setMinutes(+value)
                        break;
                }
                return accDate;
            }, new Date(new Date().setHours(0, 0, 0, 0)))
    }

    async getPlanGeneratedAccessCodes(pointOfSaleName: string, fromDate: Date, cookieJar: CookieJar) {
        const plansMap = await this.getPlans(pointOfSaleName)
        const plans = Object.values(plansMap).filter(plan => plan.pointOfSale.find(pos => pos.name === pointOfSaleName))
        const allAccessCodes = await Promise.all(plans.map(async plan => {
            const accessCodeResponse = await fetch(`https://cloud.co-co.mx/fichas/json/ver/${plan.prefix}/${plan.id}/?draw=1&start=0&length=9999&search%5Bvalue%5D=`, {
                redirect: "manual",
                headers: {
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    "content-type": "application/x-www-form-urlencoded",
                    "cookie": this.cookieJarToString(cookieJar)
                },
                referrer: "https://cloud.co-co.mx/accounts/login/",
                referrerPolicy: "strict-origin-when-cross-origin",
                method: "GET"
            })
            if (accessCodeResponse.status == 200) {
                const accessCodes = await accessCodeResponse.json() as any
                return { ...accessCodes, plan }
            }
            throw `accessCodeResponse.status=${accessCodeResponse.status}`
        }))
        const accessCodes = allAccessCodes.reduce((acc, accessCodeResponseObject) => {
            const data = accessCodeResponseObject.data.filter(accessCode => {
                const creationDate = accessCode["fecha_creacion"].match(/^(\d\d?)\/(\d\d?)\/(\d{4})/).slice(1).reduce((accDate, value, index) => {
                    switch (index) {
                        case 0:
                            // day
                            accDate.setDate(+value)
                            break;
                        case 1:
                            accDate.setMonth(+value - 1)
                            // month
                            break;
                        case 2:
                            accDate.setFullYear(+value)
                            // year
                            break;
                    }
                    return accDate;
                }, new Date())
                creationDate.setHours(0, 0, 0, 0)
                return fromDate <= creationDate
            });
            acc.recordsTotal += data.length;
            acc.data[accessCodeResponseObject.plan.id] = {
                recordsTotal: data.length,
                plan: {
                    id: +accessCodeResponseObject.plan.id,
                    plan: accessCodeResponseObject.plan.plan,
                    price: accessCodeResponseObject.plan.price,
                    currency: accessCodeResponseObject.plan.currency,
                    name: accessCodeResponseObject.plan.name
                },
                accessCodes: data.map(accessCode => {
                    return {
                        accessCodeId: +accessCode["id_ficha"],
                        createAt: this.parseDate(accessCode["fecha_creacion"]),
                        soldAt: this.parseDate(accessCode["fecha_compra"]),
                        expiration: this.parseDate(accessCode["fecha_expiracion"]),
                        accessCode: accessCode["usuario"],
                        pointOfSale: accessCode["punto_venta"],
                        active: accessCode["activada"].match(/(?<=estado-ficha-).+(?=')/)[0],
                        state: accessCode["estado"].match(/(?<=estado-ficha-).+(?=')/)[0],
                    }
                })
            }
            return acc
        }, {
            recordsTotal: 0,
            data: {}
        });
        return accessCodes;
    }
}


const test = async () => {
    const wispHub = new WispHubWispLogic(new FileKeyValueStorage());
    const username = "carlos@connecting-company"
    const password = "carloscarlos123"
    const pointOfSaleName = "3bd.02@connecting-company"
    const start = +new Date()
    console.log(`Creating new access code with username=${username} password=${password.replaceAll(/./g, '*')} pointOfSaleName=${pointOfSaleName}`)
    const cookieJar = await wispHub.login(username, password)
    const plans = await wispHub.getPlans(pointOfSaleName)
    console.log(plans);
    const now = new Date();
    const [currentMonth, currentYear] = [now.getMonth(), now.getFullYear()]
    const beginningOfTheMonth = new Date(currentYear, currentMonth, 1);
    const a = await wispHub.getPlanGeneratedAccessCodes(pointOfSaleName, beginningOfTheMonth, cookieJar);
    console.log(a);
    // try {
    //     const plans = await wispHub.refreshPlans(username, cookieJar);
    // } catch (e) {
    //     console.log(e)
    // }

    // const plans = await wispHub.getPlans(username, deviceId, pointOfSaleName, cookieJar);
    // const selectedPlan = Object.values(plans)[3];
    // console.log(`selectedPlan=${JSON.stringify(selectedPlan)}`)
    // const newAccessCode = await wispHub.createAccessCode(username, deviceId, selectedPlan, cookieJar)
    // console.log(`newAccessCode=${newAccessCode}`);
    // console.log(`time=${+new Date() - start}ms`)

}

// test()
