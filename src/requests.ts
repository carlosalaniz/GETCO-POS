
import { Response, Request } from 'express'

export interface LoginRequest extends Request {
    body: {
        username: string
        password: string
    }
}