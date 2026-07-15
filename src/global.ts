import * as timezones from "./index.ts";

(globalThis as { timezones?: typeof timezones }).timezones = timezones;
