/** Merkt Kleinigkeiten pro Browser (aktive Website, Modell). Fällt still aus, wenn gesperrt. */
export const store = {
	get(key: string) {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	set(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {}
	},
};
