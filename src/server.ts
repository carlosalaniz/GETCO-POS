
import path = require('path');
import * as cors from 'cors';
import * as express from 'express';
import { Response, Request } from 'express'
import * as bodyParser from 'body-parser';
import { LoginRequest } from './requests';
import * as passwordHash from 'password-hash';
import { FileKeyValueStorage } from './storage';
import * as jwt from 'jsonwebtoken';
import { expressjwt, Request as JWTRequest } from "express-jwt";
import { CookieJar, Plan, WispHubWispLogic } from './wispLogic';

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
const wispHubLogic = new WispHubWispLogic(storage);

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
        const [currentMonth, currentYear] = [now.getMonth(), now.getFullYear()]
        const beginningOfTheMonth = new Date(currentYear, currentMonth, 1);
        const monthlyAccessCodes = await wispHubLogic.getPlanGeneratedAccessCodes(
            req.user.wispHub.pointOfSaleName,
            beginningOfTheMonth,
            req.cookieJar
        )
        return res.json(monthlyAccessCodes);
    }
)
app.listen(port, async () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
