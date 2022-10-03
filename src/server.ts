
import path = require('path');
import * as cors from 'cors';
import * as express from 'express';
import { Response, Request } from 'express'
import * as bodyParser from 'body-parser';
import { LoginRequest } from './requests';


const app = express();
const port = 8080;

app.use(cors())
app.use(express.static('public'))
app.use(bodyParser.json());
app.get("/", async (req: Request, res: Response) => {
    res.send('Hello World');
})

app.post("/login", (req: LoginRequest, res: Response) => {
    res.send(req.body);
})

app.listen(port, async () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});