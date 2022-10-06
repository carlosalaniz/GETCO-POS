
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
import { Plan, WispHubWispLogic } from './wispLogic';

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
function jwtVerify(req: Request, res: Response) {

}
const app = express();
const port = 8080;
const storage = new FileKeyValueStorage()
const wispHubLogic = new WispHubWispLogic(storage);

const SIGN_SECRET = "The character is functionally immortal. Their latest lover, after a string of decades long tragedies, has just passed."
app.use(cors())
app.use(express.static('public'))

app.use(bodyParser.json());

// app.get("/", async (req: Request, res: Response) => {
//     res.send('Hello World');
// })


app.post("/login", async (req: LoginRequest, res: Response) => {
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
    async function (req: JWTRequest, res: express.Response) {
        const username = req.auth?.username;
        if (!username) return res.sendStatus(500)
        const userKey = `${username}-user`
        const user = storage.read<User>(userKey)
        if (!user) return res.sendStatus(401)
        const cookieJar = await wispHubLogic.login(
            user.wispHub.username, user.wispHub.password
        )
        const accessCode = await wispHubLogic.createAccessCode(
            user.wispHub.username,
            req.body as Plan,
            user.wispHub.pointOfSaleName,
            cookieJar
        );
        return res.json(accessCode);
    }
);

app.get('/refresh-plans',
    expressjwt({ secret: SIGN_SECRET, algorithms: ["HS256"] }),
    async function (req: JWTRequest, res: express.Response) {

    }
)

app.get("/monthly-access-codes",
    expressjwt({ secret: SIGN_SECRET, algorithms: ["HS256"] }),
    async function (req: JWTRequest, res: express.Response) {

    }
)
app.listen(port, async () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
