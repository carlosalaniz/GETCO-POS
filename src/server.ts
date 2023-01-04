
import path = require('path');
import * as cors from 'cors';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import { LoginRequest } from './requests';
import * as passwordHash from 'password-hash';
import { FileKeyValueStorage } from './storage';
import * as jwt from 'jsonwebtoken';
import { expressjwt, Request as JWTRequest } from "express-jwt";
import { CookieJar, Plan, WispHubWispLogic } from './wispLogic';
import * as xl from 'excel4node';

//types
type User = {
    password: string,
    pointOfSaleFriendlyName: string,
    wispHub: {
        username: string,
        password: string,
        pointOfSaleName: string
    }
}

// middleware
type userRequest = JWTRequest & { user: User, cookieJar: CookieJar }
const extractUser = () => async function (req, res, next) {
    const username = req.auth?.username;
    if (!username) return res.sendStatus(500)
    const userKey = `${username}-user`
    const user = storage.read<User>(userKey)
    if (!user) return res.sendStatus(401)
    req.user = user;
    const cookieJar = await wispHubLogic.login(
        user.wispHub.username, user.wispHub.password
    )
    req.cookieJar = cookieJar;
    next();
}

const app = express();
const port = 8080;
const storage = new FileKeyValueStorage()
const wispHubLogic = new WispHubWispLogic(storage, "pos-admin@connecting-company");

const SIGN_SECRET = "The character is functionally immortal. Their latest lover, after a string of decades long tragedies, has just passed."

app.use(cors())
app.use(express.static('public'))

app.use(bodyParser.json());

app.post("/login", async (req: LoginRequest, res: express.Response) => {
    const body = req.body;
    const userKey = `${body.username}-user`
    const user = storage.read<User>(userKey)
    if (user && passwordHash.verify(body.password, user.password)) {
        // try to login
        await wispHubLogic.login(
            user.wispHub.username, user.wispHub.password
        )
        // generate token
        const token = jwt.sign({
            username: body.username,
            pointOfSaleName: user.wispHub.pointOfSaleName,
            pointOfSaleFriendlyName: user.pointOfSaleFriendlyName,
            availablePlans: await wispHubLogic.getPlans(
                user.wispHub.pointOfSaleName
            )
        }, SIGN_SECRET);
        return res.json({ token: token })
    } else {
        return res.sendStatus(401)
    }
})

app.get('/corte', async (req: JWTRequest, res: express.Response) => {
    const adminCookieJar = await wispHubLogic.login(
        "pos-admin@connecting-company", "uCYjfr7ktPPM2jaq@QstwWwXF"
    )

    const store = Object.entries(storage.dataStore)
    const [month, year] = [+req.query.month, +req.query.year]

    const fromDate = new Date(year, month, 1);
    fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date(fromDate);
    toDate.setMonth(month + 1);
    const corte = await Promise.all(store.filter(o => /-user/.test(o[0]))
        .map(async (a: any) => {
            const monthlyAccessCodes = await wispHubLogic.getPlanGeneratedAccessCodes(
                a[1].wispHub.pointOfSaleName,
                fromDate,
                toDate,
                true,
                adminCookieJar
            )
            return { name: a[1].wispHub.pointOfSaleName, monthlyAccessCodes };
        }));
    const table = corte
        .map(pos => {
            const rows = [
                ['id', 'plan', 'precio', 'moneda', 'ventas totales', 'total']
            ]
            const sales = Object.entries(pos.monthlyAccessCodes.data as { [k: number]: any })
                .filter(([id, data]) => data.recordsTotal > 0)
                .map(
                    ([id, data]) => {
                        return [
                            data.plan.id,
                            data.plan.name,
                            data.plan.price,
                            data.plan.currency,
                            data.recordsTotal,
                            (data.recordsTotal * data.plan.price).toFixed(2)
                        ]
                    }
                )
            rows.push(...sales)
            rows.push([null, null, null, null, null, sales.reduce((acc, r) => acc + (+r[5]), 0).toFixed(2)])
            return { pos: pos.name, rows }
        })
    var wb = new xl.Workbook();
    table.forEach(t => {
        var ws = wb.addWorksheet(t.pos);
        t.rows.forEach((r, rowId) => {
            r.forEach((c, colId) => {
                var cell = ws.cell(rowId + 1, colId + 1);
                if (c)
                    if (rowId > 0 && colId === 5)
                        cell.number(+c)
                    else
                        cell.string(c.toString())
            })
        })
    })
    wb.write(`${fromDate.toLocaleString()}${toDate.toLocaleString()}.xlsx`, res);
})

app.get('/plans',
    expressjwt({ secret: SIGN_SECRET, algorithms: ["HS256"] }),
    async function (req: JWTRequest, res: express.Response) {
        const username = req.auth?.username;
        if (!username) return res.sendStatus(500)
        const userKey = `${username}-user`
        const user = storage.read<User>(userKey)
        if (!user) return res.sendStatus(401)
        const plans = await wispHubLogic.getPlans(
            user.wispHub.pointOfSaleName
        );
        return res.json(plans);
    }
)

app.post('/create-access-code',
    expressjwt({ secret: SIGN_SECRET, algorithms: ["HS256"] }),
    extractUser(),
    async function (req: userRequest, res: express.Response) {
        const accessCode = await wispHubLogic.createAccessCode(
            req.user.wispHub.username,
            req.body as Plan,
            req.user.wispHub.pointOfSaleName,
            req.cookieJar
        );
        return res.json(accessCode);
    }
);

app.get('/refresh-plans',
    expressjwt({ secret: SIGN_SECRET, algorithms: ["HS256"] }),
    extractUser(),
    async function (req: userRequest, res: express.Response) {
        const plans = await wispHubLogic.refreshPlans(
            req.user.wispHub.pointOfSaleName,
            req.cookieJar
        )
        return res.json(plans);
    }
)



app.get("/monthly-access-codes",
    expressjwt({ secret: SIGN_SECRET, algorithms: ["HS256"] }),
    extractUser(),
    async function (req: userRequest, res: express.Response) {
        const now = new Date();
        const posOnly = req.query.pos_only !== undefined ? req.query.pos_only === 'true' : true;
        const startMonth = +((
            req.query.month !== undefined
            && Number.isInteger(+req.query.month)
            && req.query.month as string
        ) || now.getMonth().toString())
        const [currentMonth, currentYear] = [startMonth, now.getFullYear()]
        const fromDate = new Date(currentYear, currentMonth, 1);
        fromDate.setHours(0, 0, 0, 0)
        const toDate = new Date(fromDate);
        toDate.setMonth(startMonth + 1);
        const monthlyAccessCodes = await wispHubLogic.getPlanGeneratedAccessCodes(
            req.user.wispHub.pointOfSaleName,
            fromDate,
            toDate,
            posOnly,
            req.cookieJar
        )

        return res.json(monthlyAccessCodes);
    }
)

app.listen(port, async () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
