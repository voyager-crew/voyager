# Comportement d'Envoi

::: info
**Note** : Cette fonctionnalité est disponible à partir de la version 1.3.7.
:::

Changez le raccourci d'envoi en `Ctrl+Entrée` (`⌘+Entrée` sur macOS), transformant `Entrée` en touche de saut de ligne pour composer vos prompts multi-lignes sereinement.

## Pourquoi cette fonctionnalité

Par défaut, appuyer sur `Entrée` envoie immédiatement le message. Lors de la rédaction de prompts plus longs, du collage de code multi-lignes ou du formatage soigné de votre saisie, cela entraîne souvent des envois accidentels — vous vouliez juste un saut de ligne, mais le message est déjà parti.

Une fois activé :

- **Entrée** → Insérer un saut de ligne
- **Ctrl+Entrée** (macOS : **⌘+Entrée**) → Envoyer le message

Maj+Entrée et la saisie IME gardent le comportement propre au site, et Ctrl/⌘+Entrée attend qu'une pièce jointe ait fini de se téléverser.

## Comment activer

1. Ouvrez la popup de Voyager.
2. Activez **Saisie** → **Ctrl/Cmd+Entrée pour envoyer**.

## Autres sites

- **AI Studio** fonctionne à l'inverse : activez **Entrée pour envoyer dans AI Studio** pour envoyer avec `Entrée`, et insérer un saut de ligne avec `Ctrl/⌘+Entrée`.
- **Claude, ChatGPT, DeepSeek, Kimi et Grok** : ouvrez la popup de Voyager sur ce site et activez **Envoyer avec Ctrl/⌘+Entrée** dans la carte **Extensions**. Les extensions de chaque site sont listées dans [Tous les plugins](/fr/guide/plugins).
- **Safari** : si Gemini demande d'appuyer deux fois sur Entrée pour envoyer, activez **Corriger la touche Entrée sur Safari**.

## Caractéristiques

- **Zéro surcharge de performance** : Désactivé, aucun écouteur d'événement clavier n'est actif — aucun impact sur les performances de la page.
- **Basculement instantané** : Les changements prennent effet immédiatement après activation dans les paramètres, sans actualisation de page.
