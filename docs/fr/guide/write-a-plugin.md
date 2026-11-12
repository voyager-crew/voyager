# Écrire son propre plugin

Pour créer un plugin à partir d'une phrase, voir [Mode création](./create-mode.md) : l'IA du site l'écrit, puis Voyager le vérifie et l'installe. Cette page couvre les deux autres façons : le confier à un agent de code sur votre ordinateur, ou l'écrire à la main. Elle donne aussi les règles du format de plugin.

Un plugin local est un plugin que vous créez pour vous-même. Il modifie l'apparence ou la mise en page de Gemini, AI Studio, ChatGPT, Claude, DeepSeek ou Kimi, il ne vit que dans votre navigateur, et il ne demande ni pull request ni copie du code source de Voyager.

La plupart des plugins sont déclaratifs : un manifest `plugin.json` et du CSS, sans code qui leur soit propre. Voyager le vérifie à l'import, applique ses modifications et les retire toutes quand vous le désactivez. Un plugin importé est désactivé au départ, pour que vous puissiez le relire avant de l'activer. Quand une demande exige du code, écrivez plutôt une [création qui exécute du code](./create-mode.md#creations-qui-executent-du-code).

Les deux façons aboutissent dans **Mes créations** : ouvrez **Autres façons d’ajouter**, choisissez **Importer des fichiers** et sélectionnez `plugin.json` et `style.css`.

## Copier pour un agent local

Si vous utilisez un agent de code (Claude Code, Codex, Cursor, etc.), écrivez une phrase dans l'onglet **Créer** du panneau ou dans **Mes créations** du popup, choisissez **Copier pour un agent local** et donnez le texte à l'agent. Ce texte lui demande de suivre la skill de plugin de Voyager :

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

La skill contient tout le contrat : les champs du manifest, ce que chaque site déclare, les primitives et ce qu'un plugin ne peut pas faire. L'agent écrit `plugin.json` et `style.css`, lance `npx create-voyager-plugin@latest check` jusqu'à ce qu'ils passent, puis vous rend les deux fichiers, que vous ajoutez avec **Importer des fichiers**.

Pour garder la skill installée, enregistrez le fichier sous `write-voyager-plugin/SKILL.md` dans le dossier des skills de votre agent (pour Claude Code, `~/.claude/skills/`).

## L'écrire à la main

Avec Node.js 18 ou plus récent :

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# modifiez my-plugin/plugin.json et my-plugin/style.css
npx create-voyager-plugin@latest check my-plugin
```

`init` génère un `plugin.json` et un `style.css` qui passent déjà les vérifications, ainsi qu'un `AGENTS.md` qui rassemble les règles du site. `--site` accepte `gemini`, `aistudio`, `chatgpt`, `claude`, `deepseek` ou `kimi`.

`check` exécute hors ligne les mêmes vérifications que l'import du popup. Il se termine avec le code 0 si le plugin peut être importé, et sinon affiche une ligne `path: message` par problème. Ajoutez `--json` pour une sortie lisible par une machine.

Une fois la vérification passée, importez les deux fichiers de la même façon, avec **Importer des fichiers** sous **Autres façons d’ajouter**.

## Ce qu'un plugin peut faire

- Ajouter du CSS, limité à une classe `gv-` que le plugin ajoute à la page.
- Ajouter une classe, définir un attribut sûr ou un style en ligne, ou masquer des éléments. Les cibles sont des clés sémantiques déclarées par le site (`userTurn`, `assistantTurn`, `composer`…) ou des sélecteurs CSS.
- Proposer des réglages dans le popup : interrupteurs, curseurs et listes déroulantes, dont les valeurs arrivent dans le CSS via des jetons `{{key}}`.
- Sur ChatGPT, Claude, DeepSeek et Kimi, activer une primitive de Voyager (copie de formules, timeline, diagrammes Mermaid, etc.) et changer les couleurs de l'interface de Voyager elle-même. Sur n'importe quel site, les variables `--gv-theme-*` sur `:root` changent les couleurs de Voyager : voir [Mode création](./create-mode.md#changer-les-couleurs-de-voyager).

## Ce qu'il ne peut pas faire

Un plugin déclaratif ne peut pas exécuter de JavaScript, réagir aux clics ou aux touches, charger quoi que ce soit depuis le réseau (polices, images, feuilles de style), lire ou réécrire le contenu d'un message, ni s'exécuter sur d'autres sites. Quand seul du code peut le faire, écrivez plutôt une création qui exécute du code. Aucune création ne peut s'exécuter sur d'autres sites ni modifier les réglages de Voyager ; pour une telle demande, les consignes de rédaction demandent à l'IA de le dire clairement et de construire la version la plus proche qui fonctionne.

## Règles vérifiées à l'import

En plus des vérifications communes du manifest (voir [Contribution Plugins](./plugin-contribution.md)), un plugin local doit :

- ne cibler que des URL situées sur un site pris en charge par Voyager ;
- n'utiliser que des clés sémantiques déclarées par tous les sites ciblés ;
- ajouter exactement une classe par `addClass`, commençant par `gv-` ;
- n'utiliser que des réglages boolean, number ou select (string et color n'ont pas encore de contrôle dans le popup) ;
- ne pas utiliser de `theme` sur Gemini ou AI Studio, et n'utiliser que les primitives que chaque site autorise : `formulaCopy`, `vimInput`, `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` et `echarts`, `sendShortcut`, `draftSave`, `turnNavigator` sur Gemini, `formulaCopy` et `sendShortcut` sur AI Studio. Elles exécutent le même code que les réglages propres à Voyager. `formulaCopy` et `vimInput` (copie des formules et mode Vim de la zone de saisie) ne tournent qu'une fois par page : le réglage intégré ou un plugin, pas les deux. Au chargement de la page, ou tant qu'aucun des deux ne tourne, le réglage intégré passe en premier ; ensuite, celui qui tourne déjà continue et l'autre apparaît en pause. Désactivez l'un pour que l'autre prenne le relais. `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` et `echarts` prennent la page élément par élément et tournent à côté du réglage intégré : une ligne ou un bloc de code que l'autre tient déjà lui est laissé.

Les traductions (`i18n`) sont facultatives.

### Primitives de chronologie, d'envoi et de brouillon

Sur Gemini grand public, le `turnNavigator` local est désormais disponible avec `params.dataBackend: "shared"` et `engine: ">=1.9.0"`. Il lit et modifie les mêmes données natives d’étoiles et de hiérarchie que la chronologie officielle ; les paramètres d’identité de la conversation, du compte et des tours ne peuvent pas être redéfinis. Le réglage officiel **Afficher la chronologie** entre en conflit avec lui : désactivez-le avant d’activer le plugin local. Pour revenir à la chronologie officielle, désactivez d’abord le plugin local, puis réactivez le réglage. Business, Enterprise et les périmètres de sites personnalisés ne sont pas pris en charge.

Sur chaque site, un seul plugin de raccourci d’envoi fonctionne par page. Si un plugin utilise déjà le mode d’envoi, un autre signale un conflit et reste en pause. Le paramètre facultatif `mode` (nécessite `"engine": ">=1.9.0"`) vaut `ctrlEnterSends` (par défaut) ou `enterSends`. La validation IME n’envoie rien. Gemini et AI Studio l’autorisent désormais ; les modes pris en charge sont décrits ci-dessous.

Sur Gemini, `sendShortcut` peut remplacer l’envoi officiel Ctrl/Cmd+Entrée : désactivez son réglage puis activez le plugin local. Seul `ctrlEnterSends` est accepté ; Enterprise reste inactif. `composerRoot` couvre les champs principal et de modification ; `sendButton` exclut l’arrêt.

Sur AI Studio, `sendShortcut` exige `params.mode: "enterSends"`. Désactivez l’envoi officiel avec Entrée pour laisser la place au plugin local. Ctrl/Cmd+Entrée ajoute une ligne ; Shift/Alt+Entrée est géré par le site.

Sur Gemini, `draftSave` partage les données officielles `gvDraft_<pathname complet>`, y compris `/u/N` et les routes Gem. La désactivation conserve les brouillons enregistrés ; plusieurs plugins de la page peuvent les partager. La fermeture tente d’enregistrer la dernière saisie, sans garantie de terminer le stockage asynchrone quand le navigateur se ferme. Les écritures et le nettoyage sont coordonnés uniquement dans cette page ; changer d’adresse e-mail dans le même emplacement `/u/N` conserve les brouillons partagés.
