# Vos Actifs Intellectuels : Bibliothèque de Prompts

Vous rédigez un prompt parfait. Il résout un problème de code complexe ou écrit un e-mail magnifique.
Le jetez-vous ?
Non. Vous le sauvegardez.

## Le Coffre-fort de Prompts

C'est votre dépôt personnel de génie.

### 1. Capturer

Quand vous écrivez quelque chose de génial, cliquez sur le bouton Voyager flottant (par défaut près de la zone de saisie, et vous pouvez le déplacer où vous voulez) pour ouvrir le **Gestionnaire de Prompts**.
Cela fait maintenant partie de votre coffre-fort.

### 2. Catégoriser

Ajoutez des étiquettes comme `code`, `email`, ou `recherche` (séparées par des virgules).
Gardez vos outils affûtés et triés.

### 3. Déployer

La prochaine fois que vous en aurez besoin, ne le retapez pas.
Ouvrez le gestionnaire, cherchez par tag ou mot-clé, et cliquez pour insérer.
Un clic. Effet de levier infini.

![Gestionnaire de Prompts](/assets/gemini-prompt-manager.png)

## Liste compacte & notes

Lorsque les prompts s'accumulent et que la liste de cartes ne suffit plus, le panneau s'adapte :

### Changer de vue

Le bouton `≡ / ▦` à droite de la barre de recherche bascule entre **Liste compacte** (par défaut) et **Vue confortable**.

- **Liste compacte** : un prompt par ligne, ~10 visibles à la fois. À droite : étiquettes · déplier · modifier · supprimer
- **Vue confortable** : aperçu Markdown complet, idéal pour une petite collection

### Nom obligatoire

Le champ **Nom** en haut du formulaire est obligatoire lors de l'ajout ou de la modification d'un prompt. Les anciens prompts sans nom sont conservés, mais devront recevoir un nom à leur prochaine modification.

### Aperçu rapide au survol

En mode compact, survolez n'importe quelle ligne pendant **~250 ms** pour voir le contenu complet dans une infobulle flottante — remplace l'infobulle `title` native du navigateur (qui peut mettre 1 à 3 s à apparaître).

### Insertion rapide avec une barre oblique

Dans la zone de saisie du chat, tapez `/` puis une partie du nom d'un prompt. La liste affiche les noms et étiquettes correspondants, suivis de **Gérer les prompts…** et **Panneau Voyager…**, qui ouvrent le gestionnaire de prompts et le [panneau Voyager](/fr/guide/panel) ; survolez un élément pour prévisualiser son contenu, puis cliquez ou appuyez sur `Tab` / `Entrée` pour le sélectionner. Le nom apparaît sous forme de jeton surligné et le contenu complet est envoyé.

![Vue en liste compacte](/assets/gemini-prompt-manager-compact.png)

## Exporter, importer et transférer

Votre bibliothèque de prompts peut être enregistrée dans un fichier JSON local ou fusionnée avec Google Drive, pour la retrouver dans un autre compte Google ou un autre navigateur.

Sur Gemini et AI Studio, ouvrez la fenêtre de Voyager et repérez **Données de prompts** dans la carte **Prompts**. Sur Claude, ChatGPT, DeepSeek et Kimi, **Données de prompts** est une carte à part dans la fenêtre, au-dessus de la carte **Extensions**.

- **Exporter** : enregistre toute la bibliothèque dans un seul fichier JSON.
- **Importer** : fusionne un fichier JSON avec votre bibliothèque. Rien de ce que vous avez déjà n'est supprimé ; un prompt déjà présent n'est gardé qu'une fois, avec ses étiquettes réunies.
- **Récupérer (fusion) / Envoyer (fusion)** : fusionne vos prompts avec ceux de Google Drive. Voir [Synchronisation cloud](/fr/guide/cloud-sync) pour connecter Drive.
- **Transférer** : cliquez sur **Exporter** dans l'ancien profil de navigateur, puis **Importer** le fichier dans le profil de votre autre compte Google ou sur un autre ordinateur.

Les prompts portant le même nom sont tous conservés, mais doivent être renommés avant de pouvoir servir à l'insertion rapide `/`.

## Disponible Partout

Le Gestionnaire de Prompts peut désormais être utilisé sur n'importe quel site web de votre choix, pas seulement Gemini™ et AI Studio.

### Comment l'Activer

Sur Claude, ChatGPT, DeepSeek et Kimi, le gestionnaire de prompts est une ligne de la carte **Extensions** du site. Ouvrez la popup de Voyager pendant que vous êtes sur le site et activez **Prompts**. Si c'est la première fonctionnalité que vous y activez, le navigateur demande l'accès au site une seule fois.

Pour tout autre site :

1. Cliquez sur l'icône Voyager dans la barre d'outils de votre navigateur.
2. Dans la carte **Accès aux sites**, allez à **Autres sites**.
3. Entrez l'adresse du site (ex : `poe.com`).
4. Cliquez sur **Ajouter** et accordez la permission.
5. **Rechargez la page cible** pour voir le bouton flottant.

### Sites IA Populaires

- `copilot.microsoft.com` - Microsoft Copilot
- `poe.com` - Poe

### Applications locales

Les adresses locales fonctionnent aussi — saisissez `localhost:3080` ou `127.0.0.1:3080` de la même manière. Par exemple, [DeepSeek Harness](/fr/guide/deepseek-harness) tourne sur `localhost:3080`, et le Gestionnaire de Prompts s'y attache comme sur n'importe quel site.

![Gestionnaire de Prompts dans DeepSeek Harness](/assets/prompt-manager-deepseek-harness.png)

::: tip
Sur les sites web que vous ajoutez vous-même, **seule** la fonctionnalité Gestionnaire de Prompts est activée. Les autres fonctionnalités comme la Chronologie et les Dossiers ne s'y chargent pas. Claude, ChatGPT, DeepSeek et Kimi sont différents : ils disposent de leurs propres extensions officielles, à parcourir dans la [liste des plugins](/fr/guide/plugins).
:::
