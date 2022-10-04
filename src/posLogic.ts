import { IKeyValueStorage } from "./storage";
import { IWispLogic } from "./wispLogic";

type AccessCode = { code: string, added_on: Date }
export class POSLogic {
    private accessCodesKey = (username: string) => `${username}-access-code`
    constructor(private wispLogic: IWispLogic, private storage: IKeyValueStorage) { }
    async login(username: string, password: string): Promise<boolean> {
        try {
            const state = await this.wispLogic.login(username, password)
            this.storage.write(username, state)
            return true;
        } catch (e) {
            console.error(e)
            throw e;
        }

    }

    async createAccessCode(username: string): Promise<string> {
        try {
            const state = await this.storage.read(username)
            if (!state) throw `username ${username} does not have an active session`
            const accessCode = await this.wispLogic.createAccessCode(username, state as any, {} as any, {} as any)
            const accessCodeKey = this.accessCodesKey(username)
            var accessCodes = await this.storage.read<AccessCode[]>(accessCodeKey) || []
            await this.storage.write<AccessCode[]>(accessCodeKey, [...accessCodes, { code: accessCode, added_on: new Date() }])
            return accessCode;
        } catch (e) {
            console.error(e)
            throw e;
        }
    }
    
    async getAccessCodes(username: string, timeFrame: { start: Date, end: Date }): Promise<string[]> {
        const accessCodeKey = this.accessCodesKey(username)
        const accessCodes = await this.storage.read<AccessCode[]>(accessCodeKey) || []
        return accessCodes.filter(ac => ac.added_on >= timeFrame.start && ac.added_on <= timeFrame.end).map(ac => ac.code)
    }

    async getAccessCodeCount(username: string, timeFrame: { start: Date, end: Date }): Promise<number> {
        return (await this.getAccessCodes(username, timeFrame)).length
    }
}
