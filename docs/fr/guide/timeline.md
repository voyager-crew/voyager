# Voyage dans le Temps

La Chronologie Voyager est un système visuel de navigation dans les conversations, pour Gemini, Claude et ChatGPT. Elle associe chaque message d'une discussion à un nœud interactif, sur le côté droit de l'écran, et transforme les longues conversations IA en une carte navigable où vous pouvez sauter instantanément.

Les longues conversations sont désordonnées. Vous faites défiler vers le haut, vers le bas, vous perdez le fil.
Voyager transforme votre conversation en une chronologie.

Sur Gemini, **Chronologie** → **Afficher la chronologie** contrôle la barre de chronologie et ses raccourcis de navigation. La désactivation conserve les étoiles et la hiérarchie enregistrées. Les heures des messages dépendent séparément de **Chronologie** → **Horodatage des messages** : elles peuvent donc rester visibles même lorsque la chronologie est désactivée.

Sur Claude, ChatGPT, DeepSeek et Grok, la barre est l’extension de chronologie du site : activez-la dans **Extensions** ; ses **Options** regroupent le style, les niveaux de nœuds (lorsqu’ils sont proposés), **Réinitialiser la position de la chronologie** et **Voir la bibliothèque enregistrée**, ainsi que les horodatages des messages sur ChatGPT.

## Visualisez la Forme de Votre Chat

Regardez sur le côté droit de votre écran.
Chaque nœud représente un message. La chronologie visualise le rythme de votre dialogue.

## La Navigation, Résolue.

- **Téléportation** : Cliquez sur un nœud pour sauter instantanément à ce message.
- **Coup d'œil** : Survolez pour voir le contenu sans bouger.
- **Signet** : Appui long sur un nœud pour le marquer d'une **Étoile**. C'est comme un marque-page pour votre cerveau.
- **Niveaux (Expérimental)** : Désactivés par défaut. Activez d'abord **Activer les niveaux de nœuds** sous **Chronologie** → **Afficher la chronologie**, une fois la ligne activée, puis faites un clic droit sur un nœud pour définir son niveau (1-3) ou réduire ses enfants. Parfait pour clarifier les conversations ramifiées. Les niveaux ne s'affichent qu'avec le style `Nœuds` : les activer bascule la chronologie sur `Nœuds`, et `Graduations` et `Compact` ne sont plus sélectionnables tant qu'ils sont actifs.
- **Redimensionner** : Faites glisser le bord intérieur de la timeline pour ajuster sa largeur.
- **Clavier** : Naviguez à la vitesse de la pensée. Par défaut `j`/`k`, `gg`/`GG` pour aller au premier/dernier tour.

![Navigation Temporelle](/assets/teaser.png)

## Étoile : Marquez vos moments clés

Les longues conversations enfouissent des pépites. Marquez d'une étoile les moments qui comptent.

**Comment ça marche** : Appuyez longuement (~0.5s) sur n'importe quel nœud de la timeline. Vous le verrez s'illuminer — ce message est maintenant étoilé.

- Appuyez longuement à nouveau pour retirer l'étoile.
- Les nœuds étoilés restent mis en évidence pour que vous puissiez les repérer d'un coup d'œil.
- Retrouvez tous vos messages marqués en un seul endroit dans la **Bibliothèque enregistrée** : cliquez sur **Voir la bibliothèque enregistrée** dans la popup de Voyager, sous **Chronologie** → **Afficher la chronologie**, une fois la ligne activée, ou ouvrez-la depuis le panneau du Gestionnaire de Prompts.

C'est comme planter un drapeau dans la conversation — le moment d'une révélation, la réponse parfaite, ou l'endroit où vous voulez reprendre plus tard.

::: tip Astuce
Les étoiles se synchronisent entre appareils si vous avez activé la [Synchronisation Cloud](/fr/guide/cloud-sync).
:::

## Personnalisez l'apparence

Dans la popup de Voyager, activez **Chronologie** → **Afficher la chronologie** pour voir ses options sous la ligne :

- **Style de la chronologie** : `Nœuds`, `Graduations` ou `Compact`.
- **Épingler le panneau d’aperçu** : garde le panneau d'aperçu ouvert à côté de la chronologie. Sa zone de recherche filtre les messages au fil de la frappe.
- **Chronologie déplaçable** : déplacez la chronologie n'importe où sur la page. **Réinitialiser la position de la chronologie** la remet à sa place.

## Encore Plus Vite au Clavier

Vous ne voulez pas utiliser la souris ? Utilisez votre clavier.

**C'est comme activer le mode Vim dans Gemini.**

### Raccourcis par Défaut

- `k` - Sauter au nœud précédent
- `j` - Sauter au nœud suivant
- `gg` - Sauter au premier tour
- `GG` - Sauter au dernier tour

### Personnalisez-le

Ouvrez les paramètres de l'extension, cliquez sur une case de raccourci, appuyez sur n'importe quelle touche.
N'importe quelle touche, n'importe quelle combinaison. `n`/`p` ? `,`/`.` ? À vous de décider.

**Mode Flux** : Les appuis rapides s'enchaînent de manière fluide.
**Mode Saut** : Réponse instantanée, vitesse maximale.

## Quand utiliser la chronologie

La chronologie est la plus utile dans les conversations de plus de 10 messages, là où faire défiler devient inefficace :

- **Sessions de recherche** : vous avez demandé à Gemini d'explorer un sujet sur plus de 30 tours. La chronologie vous permet de revenir à l'idée clé sans tout relire.
- **Débogage de code** : une longue conversation de débogage où la solution est apparue au tour 47. Marquez-la d'une étoile, retrouvez-la en un clic plus tard.
- **Apprentissage et tutorat** : progression pas à pas sur un sujet complexe. Utilisez les niveaux pour replier les sections que vous maîtrisez.
- **Relecture de brainstorming** : relisez une session créative pour en extraire les meilleures idées. Les étoiles signalent les moments à conserver.

## Chronologie ou défilement manuel

| Capacité                    | Sans chronologie                      | Avec la chronologie Voyager                                     |
| --------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| Trouver un message précis   | Remonter et redescendre sans fin      | Cliquer sur un nœud ou appuyer sur j/k                          |
| Garder les moments clés     | Copier-coller dans des notes externes | Appui long pour marquer d'une étoile, synchronisé dans le cloud |
| Voir la structure           | Lire de manière séquentielle          | Une carte visuelle montre toute la forme d'un coup d'œil        |
| Navigation au clavier       | Non disponible dans Gemini            | Touches style Vim j/k, gg/GG, entièrement personnalisables      |
| Naviguer dans 100+ messages | Plusieurs minutes de défilement       | Saut instantané vers n'importe quel point                       |
| Organiser les longs fils    | Aucun outil intégré                   | Niveaux (1 à 3) et enfants repliables (expérimental, à activer) |

## Navigateurs pris en charge

La chronologie fonctionne sur Google Gemini, ainsi que sur Claude et ChatGPT grâce aux extensions intégrées, sur Chrome, Edge, Firefox, Safari, Opera et Brave. Les raccourcis clavier et les étoiles fonctionnent de la même façon sur les trois. Les niveaux sont partout une option expérimentale à activer : sur Gemini, activez **Activer les niveaux de nœuds** sous **Chronologie** → **Afficher la chronologie**, une fois la ligne activée ; sur Claude et ChatGPT, activez le même interrupteur dans les réglages de **Timeline**, dans la section **Extensions**. Les messages étoilés se synchronisent entre appareils lorsque la [Synchro Cloud](/fr/guide/cloud-sync) est activée.

La chronologie n'est pas disponible sur AI Studio. DeepSeek et Grok disposent chacun d'une extension de chronologie facultative dans le catalogue d'extensions (livrée désactivée).
