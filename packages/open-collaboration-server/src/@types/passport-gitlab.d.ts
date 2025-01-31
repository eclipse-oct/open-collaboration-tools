declare module 'passport-gitlab2' {
    import * as oauth2 from "passport-oauth2";

    type StrategyOption = {
        clientID: string,
        clientSecret: string,
        callbackURL: string,
        baseURL?: string
    }

    type Profile = {
       provider: string
       id: string
       username: string
       displayName: string
       emails: [{
        value: string
       }]
       avatarUrl: string
       profileUrl: string
    }

    declare class Strategy extends oauth2.Strategy {
        constructor(options: StrategyOption, verify: (accessToken: string, refreshToken: string, profile: Profile, done: (error: any, user?: any) => void) => void);
    }

    export {
        Strategy
    }
}