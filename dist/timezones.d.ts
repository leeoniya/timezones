export interface TimeZoneInfo {
    /** IANA time zone identifier, for example "America/New_York". */
    name: string;
    /** Common static abbreviation, for example "EST", "EDT", or "NZDT". */
    abbr: string;
    /** UTC offset formatted as "+HH:MM" or "-HH:MM". */
    offset: string;
    /** Canonical zone name when this entry is a non-canonical alias, for example "Asia/Kolkata" for "Asia/Calcutta". */
    aliasOf?: string;
}
/**
 * Returns all IANA time zones in the generated abbreviation lookup.
 */
export declare function getAvailableTimeZones(): string[];
/**
 * Builds a snapshot of each time zone's short name and UTC offset at a
 * specific instant.
 */
export declare function getTimeZonesAt(timestamp: number): TimeZoneInfo[];
