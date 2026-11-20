import { formatAge } from "../../../components/Modal/PendingDecisionModal";

describe("formatAge", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-01-02T03:04:05Z"));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("reads as seconds, then minutes, then the wall clock time", () => {
        const now = Math.floor(Date.now() / 1000);
        expect(formatAge(now - 5)).toBe("5s");
        expect(formatAge(now - 90)).toBe("2m");
        expect(formatAge(now - 7200)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it("accepts ISO timestamps as well as epoch seconds", () => {
        const iso = new Date(Date.now() - 30000).toISOString();
        expect(formatAge(iso)).toBe("30s");
    });

    it("does not invent an age for a missing or unusable value", () => {
        expect(formatAge(undefined)).toBe("—");
        expect(formatAge("")).toBe("—");
        expect(formatAge("not a date")).toBe("not a date");
    });
});
