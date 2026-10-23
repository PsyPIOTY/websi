#!/bin/bash
# WEBSI einrichten, einmalig am MacBook (etwa 15 Minuten).
# Du meldest dich nur bei Cloudflare und GitHub an und fügst den
# GitHub-Schlüssel ein. Alles andere macht dieses Skript.
#
# Start: Terminal öffnen (Spotlight: „Terminal“) und diese Zeile einfügen:
#   curl -fsSL https://raw.githubusercontent.com/PsyPIOTY/websi/main/scripts/einrichten-macbook.sh -o /tmp/websi.sh && bash /tmp/websi.sh
#
# Noch einmal starten ist ungefährlich: Anmeldung, Datenbank, Schlüssel und
# Zugangsschutz werden erkannt und weiterverwendet. So kommt auch eine neue
# WEBSI-Fassung hoch. Läuft mit der bash 3.2 von macOS.
# shellcheck disable=SC1111,SC2016 # „…“ sind Absicht, JavaScript steht in '…'.

set -eEu
set -o pipefail

REF="${WEBSI_REF:-main}"
BASIS="${WEBSI_HOME:-$HOME/.websi}"
REPO="PsyPIOTY/websi"
WEBSITE_REPO="PsyPIOTY/psychologe-konzeptstudio"
TOKEN_SEITE="https://github.com/settings/personal-access-tokens/new?name=WEBSI&description=WEBSI%3A%20W%C3%BCnsche%20als%20Issues%2C%20Vorschl%C3%A4ge%20als%20Pull%20Requests&target_name=PsyPIOTY&expires_in=366&contents=write&issues=write&pull_requests=write"
SCHRITTE=5
SCHRITT=0
TMP="$(mktemp -d)"
exec 3<"${WEBSI_EINGABE:-/dev/tty}"

fett() { printf '\n\033[1m%s\033[0m\n' "$*"; }
sag() { printf '%s\n' "$*"; }
schritt() {
	SCHRITT=$((SCHRITT + 1))
	fett "Schritt $SCHRITT von $SCHRITTE: $*"
}
# Antwort ohne Leerzeichen am Anfang und Ende.
frage() {
	printf '%s ' "$1"
	read -r ANTWORT <&3
}
geheim() {
	printf '%s ' "$1"
	read -rs ANTWORT <&3
	printf '\n'
}
enter() { frage "${1:-Weiter mit Enter.}"; }
fehler() {
	# Nur einmal melden, nicht noch einmal aus $(...) heraus.
	[ "$BASH_SUBSHELL" = 0 ] || return 0
	{
		fett "Das hat nicht geklappt (Schritt $SCHRITT von $SCHRITTE)."
		sag "Mach ein Bildschirmfoto von diesem Fenster und schick es Paco. Darin stehen keine Passwörter."
		sag "Danach kannst du das Skript einfach noch einmal starten."
	} >&2
}
trap fehler ERR
trap 'rm -rf "$TMP"' EXIT

# Wert aus einer JSON-Datei, z. B.: json datei.json 'd.accounts.length'
# Ein drittes Argument steht im Ausdruck als a bereit.
json() {
	node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const r = new Function("d", "a", "return (" + process.argv[2] + ")")(d, process.argv[3]);
process.stdout.write(r == null ? "" : String(r));' "$@"
}
W() { npx --no-install wrangler "$@"; }

node_passt() {
	command -v node >/dev/null 2>&1 &&
		node -e 'const [a, b] = process.versions.node.split(".").map(Number);
process.exit(a > 22 || (a === 22 && b >= 12) || (a === 20 && b >= 19) ? 0 : 1);'
}

installiere_node() {
	local quelle="https://nodejs.org/dist/latest-v22.x" pkg soll ist
	sag "Node.js fehlt oder ist zu alt. Ich lade Version 22 von nodejs.org und installiere sie."
	sag "Der Mac fragt dann nach deinem Mac-Passwort. Beim Tippen siehst du nichts, das ist normal."
	enter
	curl -fsSL "$quelle/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
	pkg="$(awk '$2 ~ /^node-v22\.[0-9.]+\.pkg$/ { print $2; exit }' "$TMP/SHASUMS256.txt")"
	[ -n "$pkg" ]
	curl -fL --progress-bar "$quelle/$pkg" -o "$TMP/$pkg"
	# Ohne ( ... ): Die bash 3.2 verliert dort mit ERR-Trap den Fehlerstatus.
	soll="$(awk -v p="$pkg" '$2 == p { print $1 }' "$TMP/SHASUMS256.txt")"
	ist="$(shasum -a 256 "$TMP/$pkg" | awk '{ print $1 }')"
	if [ -z "$soll" ] || [ "$soll" != "$ist" ]; then
		sag "Die Prüfsumme von nodejs.org passt nicht. Ich installiere nichts."
		false
	fi
	sudo installer -pkg "$TMP/$pkg" -target / >/dev/null
	PATH="/usr/local/bin:$PATH"
	hash -r
	node_passt
}

# Leitet Access die Adresse auf die Anmeldung um, steht dort der Teamname.
access_team() {
	local ziel
	ziel="$(curl -s -o /dev/null -w '%{redirect_url}' "$ADRESSE/" || true)"
	TEAM="$(printf '%s' "$ziel" | sed -n 's#^https://\([a-z0-9-]*\)\.cloudflareaccess\.com/.*#\1#p')"
	[ -n "$TEAM" ]
}

# ---------------------------------------------------------------------------
schritt "Werkzeuge prüfen und WEBSI herunterladen"
if ! node_passt; then installiere_node; fi
ZIEL="$BASIS/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ZIEL"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" |
	tar -xz -C "$ZIEL" --strip-components 1
cd "$ZIEL"
sag "Ich installiere die Bausteine, das dauert 1 bis 2 Minuten."
npm ci --no-audit --no-fund --loglevel=error >"$TMP/npm.log" 2>&1 </dev/null ||
	{ tail -20 "$TMP/npm.log"; false; }

# ---------------------------------------------------------------------------
schritt "Bei Cloudflare anmelden"
if W whoami --json >"$TMP/wer.json" 2>/dev/null; then
	sag "Du bist schon angemeldet."
else
	sag "Gleich öffnet sich der Browser. Melde dich bei Cloudflare an und bestätige mit „Allow“."
	enter
	W login
	W whoami --json >"$TMP/wer.json"
fi
KONTO="$(cat "$BASIS/konto" 2>/dev/null || true)"
if [ "$(json "$TMP/wer.json" 'd.accounts.some((k) => k.id === a)' "$KONTO")" != true ]; then
	ANZAHL="$(json "$TMP/wer.json" 'd.accounts.length')"
	[ "$ANZAHL" -ge 1 ]
	NR=1
	if [ "$ANZAHL" != 1 ]; then
		sag "Du hast mehrere Cloudflare-Konten:"
		json "$TMP/wer.json" 'd.accounts.map((k, i) => "  " + (i + 1) + "  " + k.name).join("\n")'
		printf '\n'
		while :; do
			frage "Welches gehört zu deinen Websites? Nummer:"
			case "$ANTWORT" in '' | *[!0-9]*) continue ;; esac
			NR=$((10#$ANTWORT))
			if [ "$NR" -ge 1 ] && [ "$NR" -le "$ANZAHL" ]; then break; fi
		done
	fi
	KONTO="$(json "$TMP/wer.json" "d.accounts[$((NR - 1))].id")"
	printf '%s' "$KONTO" >"$BASIS/konto"
fi
export CLOUDFLARE_ACCOUNT_ID="$KONTO"
# Access lässt die Mitglieder des Cloudflare-Kontos herein, WEBSI nur diese Adresse.
MAIL="$(json "$TMP/wer.json" 'd.email || ""')"
while [ -z "$MAIL" ]; do
	frage "Mit welcher Mail-Adresse meldest du dich bei Cloudflare an?"
	case "$ANTWORT" in
	*[[:space:]]*) sag "Bitte ohne Leerzeichen." ;;
	*@*.*) MAIL="$ANTWORT" ;;
	*) sag "Das sieht nicht nach einer Mail-Adresse aus." ;;
	esac
done
sag "WEBSI lässt nur dich herein: $MAIL"

# ---------------------------------------------------------------------------
schritt "Datenbank anlegen und WEBSI hochladen"
db_id() { json "$TMP/d1.json" '(d.find((x) => x.name === "websi") || {}).uuid || ""'; }
W d1 list --json >"$TMP/d1.json"
DB="$(db_id)"
if [ -z "$DB" ]; then
	W d1 create websi --jurisdiction eu --update-config=false >/dev/null </dev/null
	W d1 list --json >"$TMP/d1.json"
	DB="$(db_id)"
fi
[ -n "$DB" ]
node -e 'const fs = require("fs");
const text = fs.readFileSync("wrangler.jsonc", "utf8");
const next = text.replace(/"database_id":\s*"[^"]*"/, () => `"database_id": "${process.argv[1]}"`);
if (next === text && !text.includes(process.argv[1])) process.exit(1);
fs.writeFileSync("wrangler.jsonc", next);' "$DB"
sag "Ich baue WEBSI und lade es hoch, das dauert etwa eine Minute."
npm run deploy >"$TMP/deploy.log" 2>&1 </dev/null || { tail -30 "$TMP/deploy.log"; false; }
ADRESSE="$(grep -o 'https://websi\.[a-z0-9-]*\.workers\.dev' "$TMP/deploy.log" | head -1)"
[ -n "$ADRESSE" ]
sag "WEBSI ist hochgeladen: $ADRESSE"

# ---------------------------------------------------------------------------
schritt "GitHub-Schlüssel für WEBSI"
W secret list --name websi --format json >"$TMP/geheim.json" 2>/dev/null || printf '[]' >"$TMP/geheim.json"
NEU=ja
if [ "$(json "$TMP/geheim.json" 'd.some((s) => s.name === "GITHUB_TOKEN")')" = true ]; then
	frage "Der GitHub-Schlüssel ist schon hinterlegt. Neu eingeben? j = ja, Enter = nein:"
	case "$ANTWORT" in j | J | ja | Ja) ;; *) NEU=nein ;; esac
fi
if [ "$NEU" = ja ]; then
	open "$TOKEN_SEITE"
	sag "Im Browser ist GitHub offen, fast alles ist schon ausgefüllt:"
	sag "  1. Bei „Repository access“: „Only select repositories“, dann psychologe-konzeptstudio wählen."
	sag "  2. Ganz unten „Generate token“, dann den Schlüssel mit dem Kopier-Symbol kopieren."
	while :; do
		geheim "Schlüssel hier einfügen (Cmd+V, du siehst dabei nichts), dann Enter:"
		CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$ANTWORT" |
			curl -s -o /dev/null -w '%{http_code}' -K - "https://api.github.com/repos/$WEBSITE_REPO" || true)"
		if [ "$CODE" = 200 ]; then break; fi
		sag "Der Schlüssel passt noch nicht (GitHub meldet $CODE). Ist psychologe-konzeptstudio ausgewählt?"
	done
	# Geheimnisse nur über die Leitung, nie in eine Datei.
	GH="$ANTWORT" EMAIL="$MAIL" node -e 'process.stdout.write(JSON.stringify(
	{ GITHUB_TOKEN: process.env.GH, ALLOWED_EMAIL: process.env.EMAIL }));' |
		W secret bulk --name websi >/dev/null
	sag "Gespeichert."
else
	printf '%s' "$MAIL" | W secret put ALLOWED_EMAIL --name websi >/dev/null
fi

# ---------------------------------------------------------------------------
schritt "Zugangsschutz einschalten"
if access_team; then
	sag "Der Zugangsschutz ist schon an."
else
	open "https://dash.cloudflare.com/$KONTO/workers/services/view/websi/production"
	sag "Im Browser ist WEBSI bei Cloudflare offen (sonst: Workers & Pages, dann websi):"
	sag "  1. Oben den Reiter „Access“ wählen."
	sag "  2. „Protect this Worker behind Access“, dann „All traffic“."
	sag "  3. Bei „Authentication policy“: „Cloudflare account“. Dann „Apply Access“."
	sag "  Fragt Cloudflare zuerst nach Zero Trust: Teamname z. B. peterjarek, Plan „Free“ (0 €)."
	sag "  Cloudflare will dafür eine Zahlungsart, auch wenn nichts kostet."
	enter "Wenn das erledigt ist: Enter."
	VERSUCHE=0
	until access_team; do
		VERSUCHE=$((VERSUCHE + 1))
		sag "Ich sehe den Zugangsschutz noch nicht. Manchmal dauert es eine Minute."
		if [ "$VERSUCHE" -ge 3 ]; then
			frage "Teamnamen selbst eintragen (Zero Trust, Settings, „Team domain“) oder Enter für neu prüfen:"
			TEAM="$(printf '%s' "$ANTWORT" | sed 's#^https://##; s#\.cloudflareaccess\.com.*##')"
			if [ -n "$TEAM" ]; then break; fi
		else
			enter "Enter, um noch einmal zu prüfen."
		fi
	done
fi
printf '%s' "$TEAM" | W secret put ACCESS_TEAM_DOMAIN --name websi >/dev/null

# ---------------------------------------------------------------------------
FUER_PACO="WEBSI: $ADRESSE
Datenbank websi: $DB
Access-Team: $TEAM
Anmeldung: $MAIL"
fett "Fertig. WEBSI läuft: $ADRESSE"
open "$ADRESSE"
sag "Im Browser öffnet sich WEBSI. Melde dich mit deinem Cloudflare-Zugang an ($MAIL)."
sag "Am iPhone in Safari dieselbe Adresse, dann „Teilen“ und „Zum Home-Bildschirm“."
sag ""
sag "Für Paco (keine Geheimnisse):"
printf '%s\n' "$FUER_PACO" | sed 's/^/  /'
if command -v pbcopy >/dev/null 2>&1; then
	printf '%s\n' "$FUER_PACO" | pbcopy
	sag "Das steht schon in der Zwischenablage: im Thread einfach einfügen (Cmd+V)."
fi
