# ✨ Fonctionnalités

## 🌌 Noyau Commun (Gemini & AI Studio)

- **📂 [Dossiers](https://voyager.nagi.fun/fr/guide/folders)** : organisez vos discussions dans une hiérarchie de dossiers jusqu’à trois niveaux, avec prise en charge du glisser-déposer.
  - **Gemini** : Support du **mode d'isolation de compte** et **couleurs de dossiers personnalisées**.
- **💡 [Coffre-fort de Prompts](https://voyager.nagi.fun/fr/guide/prompts)** : Enregistrez et réutilisez vos meilleurs prompts sur Gemini, AI Studio et [sites personnalisés](https://voyager.nagi.fun/fr/guide/prompts#disponible-partout).
- **☁️ [Synchronisation Cloud](https://voyager.nagi.fun/fr/guide/cloud-sync)** : synchronisez dossiers et prompts via Google Drive, ou via iCloud sur Safari.
- **🗑️ [Suppression par lot](https://voyager.nagi.fun/fr/guide/batch-delete)** : supprimez les conversations en masse.
- **📐 [Copie de Formules](https://voyager.nagi.fun/fr/guide/formula-copy)** : cliquez sur une formule pour la copier en LaTeX, en MathML (Word) ou en notation mathématique prête pour Notion.

## ✨ Fonctions Exclusives Gemini

- **📍 [Navigation Temporelle](https://voyager.nagi.fun/fr/guide/timeline)** : Des nœuds visuels pour naviguer entre les messages, marquer les moments clés et gérer les branches de conversation.
- **💾 [Export de Chat](https://voyager.nagi.fun/fr/guide/export)** : exportez vos conversations en JSON, Markdown, PDF ou image, images incluses.
- **🧜‍♀️ [Rendu Mermaid](https://voyager.nagi.fun/fr/guide/mermaid)**: Rendu automatique des organigrammes, diagrammes de séquence et autres graphiques Mermaid.
- **📝 [Correction du Rendu Markdown](https://voyager.nagi.fun/fr/guide/markdown-fix)**: Répare automatiquement la syntaxe Markdown grasse corrompue par les éléments HTML injectés par Gemini.
- **🍌 [Image Refinement](https://voyager.nagi.fun/fr/guide/nanobanana)** : Suppression sans perte du filigrane Gemini sur les images générées.
- **🔬 [Deep Research](https://voyager.nagi.fun/fr/guide/deep-research)** : Extrayez les processus de réflexion et les liens de recherche des sessions Deep Research.
- **🛠️ Outils de Productivité** :
  - **[Réponse avec Citation](https://voyager.nagi.fun/fr/guide/quote-reply)** : Répondez avec contexte en sélectionnant simplement du texte.
  - **[Empêcher le défilement auto](https://voyager.nagi.fun/fr/guide/prevent-auto-scroll)** : Intercepte le saut incontrôlé vers le bas de la page.
  - **[Réduction Entrée](https://voyager.nagi.fun/fr/guide/input-collapse)** : Zone de saisie auto-réductible pour plus d'espace de lecture.
  - **[Modèle par Défaut](https://voyager.nagi.fun/fr/guide/default-model)** : Définissez votre modèle préféré par défaut.

## 🔌 Claude, ChatGPT, DeepSeek & Kimi

Grâce au [moteur d'extensions Voyager](https://voyager.nagi.fun/fr/guide/plugins), ces fonctionnalités étendent votre expérience au-delà de Gemini. Activez-les dans la fenêtre de l'extension et accordez l'accès à chaque site :

- **📍 Timeline** : la même chronologie, avec les messages en favori et la recherche, sur ChatGPT, Claude et DeepSeek. Désactivée tant que vous ne l’activez pas.
- **📂 Dossiers** : rangez vos conversations dans des dossiers sur ChatGPT, Claude, DeepSeek et Kimi. Ceux de ChatGPT sont activés par défaut.
- **💾 Export** : exportez une conversation en Markdown, JSON, PDF ou image sur ChatGPT, Claude, DeepSeek et Kimi.
- **📐 Copie de formules** : cliquez sur une formule pour copier son LaTeX sur Claude, ChatGPT et DeepSeek.
- **⌨️ Saisie Vim** : édition modale façon Vim et déplacement du curseur dans la zone de saisie de Claude, ChatGPT et DeepSeek.
- **📖 Largeur de lecture confortable** : Ajustez la largeur de chat pour une meilleure expérience de lecture sur Claude, ChatGPT, DeepSeek et Kimi.
- **💬 Outils du quotidien** : citation de réponses, Ctrl/⌘+Entrée pour envoyer et compteur de brouillon sur Claude, ChatGPT, DeepSeek et Kimi ; enregistrement automatique des brouillons sur Claude, DeepSeek et Kimi.
- **🈶 Correction CJK** : Correction des problèmes de rendu des caractères CJK sur Claude.
- **📜 Code sans retour à la ligne** : Sur DeepSeek, les longues lignes de code défilent horizontalement au lieu de passer à la ligne, préservant l'indentation.

## 🧩 N'importe quel site — même en localhost

Ajoutez n'importe quel site depuis la popup et le Prompt Manager vous y suit, applications locales comprises. Le voici dans [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) sur `localhost:3080` :

<p align="center">
  <img src="../../../docs/public/assets/prompt-manager-deepseek-harness.png" alt="Prompt Manager dans DeepSeek Harness" width="720">
</p>

## 🎨 Personnalisation

- **🌦️ Effets visuels** : Ajoutez une ambiance saisonnière avec **neige**, **pluie cinématique** ou **pétales de sakura** sur chaque site où Voyager est actif.
- Sur Gemini et AI Studio, ouvrez le popup de l'extension, activez **Mise en page** → **Effets visuels**, puis choisissez `Neige`, `Sakura` ou `Pluie` sous la ligne ; désactivez-la pour couper l'effet. Sur Claude, ChatGPT, DeepSeek et les sites personnalisés, la même ligne se trouve dans la carte **Extensions** du site.
- Les effets sont rendus sous forme de couches légères plein écran qui ne bloquent pas l'interaction avec la page.
- Lors du changement d'effet ou de la désactivation, les particules s'estompent naturellement au lieu de disparaître brusquement.
