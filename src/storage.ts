export interface IKeyValueStorage {
    write<T>(key: string, data: T): T
    read<T>(key: string): T | undefined
}

export class MemoryKeyValueStorage implements IKeyValueStorage {
    dataStore = {}
    write<T>(key: string, data: T) {
        this.dataStore[key] = data
        return data
    }
    read<T>(key: string): T | undefined {
        return this.dataStore[key]
    }
}

import * as fs from "fs";
export class FileKeyValueStorage implements IKeyValueStorage {
    private storagePath = "./.data_store"
    dataStore = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'))
    write<T>(key: string, data: T) {
        this.dataStore[key] = data
        fs.writeFileSync(this.storagePath, JSON.stringify(this.dataStore));
        return data
    }
    read<T>(key: string): T | undefined {
        return this.dataStore[key] as T
    }
}