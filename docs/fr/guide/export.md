# Liberté Totale

Le verrouillage des données est l'ennemi.
Nous croyons que si vous le créez, vous le possédez.

Voyager Export vous permet de télécharger n'importe quelle conversation Gemini, ChatGPT, Claude, DeepSeek ou Kimi au format Markdown, PDF, JSON ou image. Il extrait l'intégralité du contenu, y compris les blocs de code, les images et la mise en forme, et vous offre une copie permanente et portable de chaque conversation IA.

## Comparaison des formats

| Critère           | Markdown                                 | PDF                      | JSON                             | Image               |
| ----------------- | ---------------------------------------- | ------------------------ | -------------------------------- | ------------------- |
| Idéal pour        | Applications de notes (Obsidian, Notion) | Partage et impression    | Développeurs, analyse de données | Partage sur mobile  |
| Images            | Intégrées                                | Entièrement incluses     | Encodées en base64               | Rendues sur place   |
| Blocs de code     | Conservés avec la coloration syntaxique  | Rendus visuellement      | Texte brut conservé              | Rendus visuellement |
| Taille du fichier | La plus petite                           | La plus grande           | Moyenne                          | Grande              |
| Recherchable      | Texte brut                               | Recherche du lecteur PDF | Accès programmatique             | Non                 |

## Tout Exporter

Voyager vous permet de retirer vos données du cloud pour les mettre entre vos mains.

### Les Formats

- **Markdown** : Pour votre coffre Obsidian ou Notion. Texte propre et formaté avec images intégrées.
- **PDF** : Pour partager ou imprimer. Mise en page magnifique, images incluses.
- **JSON** : Données brutes. Pour les développeurs qui veulent construire par-dessus leur historique.
- **Image** : Un long PNG, parfait pour le partage sur téléphone. Choisissez une mise en page étroite, moyenne ou large.

### Comment Exporter

1. Cliquez sur le bouton **Exporter** (ChatGPT, Claude, DeepSeek, Kimi et les mises en page actuelles de Gemini). Il se trouve par défaut en haut à droite de la page ; faites-le glisser où vous voulez, chaque site retient sa position, et le déposer près de sa position par défaut l'y remet. Sur Gemini, vous pouvez aussi choisir **Exporter l'historique de la conversation** dans le menu ⋮ d'une conversation ou d'une réponse ; sur les anciennes mises en page de Gemini, survolez le logo Gemini pour voir l'**Icône d'Export**.
2. Choisissez votre format.
3. C'est fait.

Sur Claude, DeepSeek et Kimi, l'export est une extension désactivée par défaut : activez-la d'abord dans la section **Extensions** du popup. Voyager fait défiler une longue conversation pour la lire en entier, puis tous les messages sont sélectionnés au départ ; décochez ceux dont vous ne voulez pas. S'il ne peut pas confirmer le début et la fin, il prévient que l'export est peut-être incomplet. Sur ChatGPT, s'il ne parvient pas à lire tout l'historique, il le signale et vous invite à faire défiler vers le haut pour charger les messages précédents, puis à réessayer. Passer à une autre conversation arrête l'export, tout comme le début d'une nouvelle réponse sur Claude.

Les fichiers envoyés dans une conversation ChatGPT figurent dans l'export sur une ligne `📎 nom du fichier`.

Ce sont vos données. Faites-en ce que vous voulez.

<div style="display: flex; gap: 20px; margin-top: 20px;">
  <div style="flex: 1; text-align: center;">
    <p><b>Étape 1 : Trouver Exporter</b></p>
    <img src="/assets/gemini-export-guide-1.png" alt="Guide export étape 1" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
  <div style="flex: 1; text-align: center;">
    <p><b>Étape 2 : Le Choix</b></p>
    <img src="/assets/gemini-export-guide-2.png" alt="Guide export étape 2" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
</div>

### Remarque concernant l'exportation PDF sur Safari

L'exportation en PDF sur Safari nécessite une procédure légèrement différente (impression manuelle) :

1. Cliquez sur le bouton **Exporter** et sélectionnez le format PDF.
2. **Attendez environ une seconde** (pour permettre à la page de préparer les styles d'impression).
3. Appuyez sur `Command + P` pour ouvrir la boîte de dialogue d'impression.
4. Sélectionnez **"Enregistrer au format PDF"** (Save to PDF) dans la boîte de dialogue d'impression.

<img src="/assets/safari-export-pdf.png" alt="Safari Export PDF" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-top: 20px;"/>

## Export des rapports Deep Research

Le mode Deep Research de Gemini produit des rapports structurés, avec sources, étapes de réflexion et citations. Voyager peut exporter ces sessions avec toutes leurs métadonnées :

1. Ouvrez une conversation Deep Research terminée.
2. Ouvrez le menu **Partager et exporter** du rapport et choisissez **Save Report**.
3. Choisissez votre format.
4. L'export contient le rapport final avec ses liens vers les sources. Pour enregistrer aussi le processus de réflexion, voir [Export Deep Research](/fr/guide/deep-research).

C'est utile pour la recherche académique, l'analyse concurrentielle et la documentation technique, lorsqu'il faut conserver la chaîne de raisonnement et l'attribution des sources.

## Quand exporter

- **Archivage des connaissances** : sauvegardez les conversations importantes avant qu'elles ne disparaissent dans votre historique.
- **Partage en équipe** : exportez une session de débogage en PDF pour la partager avec des collègues qui n'utilisent pas Gemini.
- **Constitution d'une base de connaissances** : exportez les conversations en Markdown et classez-les dans Obsidian ou Notion.
- **Analyse de données** : utilisez les exports JSON pour analyser par programme les schémas de conversation ou extraire des données structurées.
- **Conformité et audit** : conservez la trace des décisions prises avec l'aide de l'IA.

## Plateformes prises en charge

L'export fonctionne sur Gemini et ChatGPT, sur Chrome, Edge, Firefox, Safari, Opera et Brave. Sur Claude, DeepSeek et Kimi, l'export passe par des extensions désactivées par défaut, à activer dans **Extensions**. Sur Safari, l'export PDF passe par une étape d'impression manuelle (Commande+P après avoir cliqué sur Exporter) ; les exports Markdown et JSON incluent toujours les images.
