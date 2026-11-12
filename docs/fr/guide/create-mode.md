# Mode création

Dites en une phrase comment un site doit changer. L'IA du site l'écrit sous forme de plugin, puis Voyager le vérifie et l'installe pour vous. Pas de code, et vous ne quittez jamais la conversation en cours. Cela fonctionne sur Gemini, AI Studio, ChatGPT, Claude, DeepSeek et Kimi.

Le mode création a deux points d'entrée : l'onglet **Créer** du [panneau Voyager](./panel.md) sur la page, et la carte **Mes créations** du popup de Voyager. Ce qu'il produit est un plugin local, qui ne vit que dans votre navigateur. Pour écrire un plugin vous-même ou le confier à un agent de code, voir [Écrire son propre plugin](./write-a-plugin.md).

## Créer sur la page

<GuideOp>

Le plus rapide se fait sur le site d'IA auquel le plugin est destiné : ouvrez-y le panneau Voyager et choisissez **Créer**.

</GuideOp>

<GuideSteps>
<GuideStep>

Écrivez une phrase sous **Que faut-il changer ?**, par exemple « Rends mes messages plus étroits et masque la barre latérale », puis choisissez **Créer sur cette page**.

</GuideStep>
<GuideStep>

Voyager ouvre un nouveau chat sur ce site et place votre demande dans la zone de saisie. Relisez-la, puis envoyez-la vous-même : Voyager n'appuie jamais sur envoyer. Si la zone de saisie contient déjà du texte, Voyager n'y touche pas et vous demande d'abord de l'envoyer ou de l'effacer.

</GuideStep>
<GuideStep>

L'IA lit la page de Voyager pour ce site et répond avec un seul bloc de code JSON. Sous le bloc, Voyager ajoute **Aperçu et installation**.

</GuideStep>
<GuideStep>

Choisissez-le. Le panneau s'ouvre sur une revue : les sites où le plugin s'applique, chaque changement, son CSS en entier et ce qui figure sous **À vérifier**. Choisissez **Installer et activer**, et il s'applique tout de suite. Vous pouvez le désactiver à tout moment dans **Fonctions**.

</GuideStep>
</GuideSteps>

<GuideOp>

Pour modifier le plugin, dites-le à l'IA dans le même chat.

- **Une nouvelle version** : sous sa nouvelle réponse, Voyager propose **Aperçu de la mise à jour**, puis **Mettre à jour et activer** ; l'ancien bloc indique **Version précédente**.
- **Déjà installé** : la version que vous avez installée indique **Installé**.
- **Seulement dans les chats de création** : Voyager ne lit les réponses que dans un chat où votre message contient le lien de la page de création de Voyager, ce que fait toujours la demande de **Créer sur cette page**. Dans tout autre chat, rien n'apparaît sous les réponses ; passez plutôt par le popup, comme décrit plus bas.

</GuideOp>

## Ajouter la structure de la page

<GuideOp>

L'onglet **Créer** a un seul interrupteur : **Ajouter la structure de cette page, sans aucun de ses textes, pour que l’IA écrive pour ce qui s’y trouve**. Il est activé par défaut. L'IA écrit ainsi pour la page telle qu'elle est vraiment, au lieu de deviner.

- **Ce qui est ajouté** : les éléments de page que Voyager reconnaît et leur nombre, ainsi que l'arbre des éléments autour de la dernière réponse et de votre dernier message.
- **Ce qui est laissé de côté** : tout texte de la page, les liens, vos conversations, et les valeurs d'attribut qui ressemblent à des données, comme des identifiants, des adresses e-mail ou de longs nombres.
- **Voir ce qui est ajouté** : ouvrez-le pour lire exactement le texte qui sera joint. Il relit la page quand celle-ci change.
- **Désactivé** : désactivez l'interrupteur, et la demande ne contient que votre phrase.

</GuideOp>

## L'avertissement sur le modèle dans Gemini

<GuideOp>

Sur Gemini, Voyager vérifie d'abord quel modèle le nouveau chat utilisera. S'il s'agit d'un modèle plus léger comme Flash ou Flash-Lite, le haut de l'onglet **Créer** indique que ce modèle n'arrive généralement pas à écrire un plugin.

- **Ce qu'il propose** : l'avertissement nomme un modèle plus puissant à choisir dans le menu des modèles de Gemini, ou propose de confier la demande à un agent de code local (**Copier pour un agent local** se trouve dans l'avertissement).
- **Vérifier à nouveau** : après avoir changé de modèle dans Gemini, choisissez **Vérifier à nouveau**. Voyager vérifie aussi de nouveau quand vous revenez au panneau.
- **Modèle par défaut** : si vous utilisez [Modèle par Défaut](./default-model.md), Voyager se fie au modèle par défaut que recevra le nouveau chat.
- **Rien n'est bloqué** : ce n'est qu'un avertissement. **Créer sur cette page** fonctionne toujours.

</GuideOp>

## Quand une réponse ne peut pas être installée

<GuideOp>

Toutes les réponses ne sont pas réussies. Sous une réponse qu'il ne peut pas installer, Voyager explique pourquoi en termes simples, par exemple « Il n’indique pas sur quel site il s’applique » ou « L’une de ses modifications n’est pas autorisée ».

- **Lui demander de corriger** : choisissez **Lui demander de corriger** sous la réponse. Voyager place la liste des problèmes dans la zone de saisie, après ce que vous avez déjà écrit, et c'est vous qui l'envoyez.
- **Une fois corrigé** : quand l'IA répond avec une version corrigée, **Aperçu et installation** apparaît dessous.
- **Pendant la revue** : si les problèmes n'apparaissent que dans la revue du panneau, Voyager n'installe rien et en donne la liste.

</GuideOp>

## Après l'installation

<GuideOp>

Tout ce que vous avez installé se trouve dans **Mes créations**. Dans le panneau, c'est un groupe de l'onglet **Fonctions**. Dans le popup, sur Gemini et AI Studio, c'est une carte des réglages, juste sous **Synchro Cloud** sauf si vous la déplacez, et **Aller à**, en haut du popup, y mène ; sur ChatGPT, Claude, DeepSeek et Kimi, elle se trouve sous la liste des plugins.

- **Interrupteur** : chaque création a sa ligne et s'active ou se désactive comme n'importe quelle autre fonction.
- **Supprimer** : choisissez l'icône de corbeille et confirmez pour la retirer de ce navigateur. C'est irréversible.
- **Exporter** : choisissez **Exporter** sur la création dans la liste **Mes créations** du popup, puis importez le fichier JSON dans un autre navigateur.
- **La partager** : si elle peut servir à tout le monde, proposez-la pour le catalogue officiel : [Contribution Plugins](./plugin-contribution.md) décrit la marche à suivre.

</GuideOp>

### La vérification automatique

<GuideOp>

Quand le panneau s'ouvre, Voyager regarde si chaque création de **Mes créations** fait quelque chose sur la page actuelle.

- **Rien ne correspond** : une création qui change le style est activée, mais aucun élément qu'elle modifie n'est sur cette page. Sa ligne indique **Activé, mais rien sur cette page ne lui correspond**. Les états de survol et de focus ne sont pas pris en compte, pas plus que les créations qui ne font qu'appeler des fonctions intégrées.
- **Une page figée** : quand une création qui exécute du code a bloqué la page, Voyager l'a déjà désactivée, et sa ligne indique pourquoi.
- **Demander une correction** : dans les deux cas, **Demander une correction** est proposé. Voyager ouvre un nouveau chat sur ce site et y place ce qu'il a vu sur la page et le plugin tel qu'il est installé (plus la structure de la page tant que cet interrupteur est activé). Le panneau se ferme pour que vous puissiez le relire et l'envoyer.

</GuideOp>

## Changer les couleurs de Voyager

<GuideOp>

Une création peut aussi changer les couleurs de l'interface de Voyager sur la page, là encore à partir d'une phrase, par exemple « Donne aux panneaux et à la chronologie de Voyager une palette Nord ». L'IA définit les variables de couleur publiques de Voyager dans une seule règle `:root`, et elles s'appliquent en thème clair comme en thème sombre.

- **Ce qui suit la palette** : le fond, le texte, les bordures et la couleur de survol des panneaux, menus, boîtes de dialogue, info-bulles et notifications ; l'accent des boutons, de la sélection et du focus ; la couleur de danger pour la suppression.
- **La chronologie** : son rail, ses points et graduations au repos, et la piste du curseur de gauche ont leur propre couleur.
- **Ce qui continue de suivre le site** : le texte, les bordures et la couleur de survol que Voyager dessine directement sur la page du site. Un texte clair ne tombe ainsi jamais sur le fond clair du site. Le popup de Voyager n'est pas concerné.

</GuideOp>

<GuideNote>

**Un exemple Nord** : la phrase ci-dessus donne en général un CSS comme celui-ci. Une variable non définie garde la couleur propre à Voyager.

```css
:root {
  --gv-theme-surface: #2e3440;
  --gv-theme-hover: #3b4252;
  --gv-theme-text: #eceff4;
  --gv-theme-text-muted: #d8dee9;
  --gv-theme-border: #4c566a;
  --gv-theme-accent: #88c0d0;
  --gv-theme-accent-fg: #2e3440;
  --gv-theme-danger: #bf616a;
  --gv-theme-timeline: #81a1c1;
}
```

Toutes les variables : `--gv-theme-surface` (fond), `-hover` (lignes survolées), `-text` (texte), `-text-muted` (texte secondaire, icônes), `-border` (bordures), `-accent` (boutons, sélection, focus), `-accent-fg` (texte sur l'accent), `-accent-hue` (la teinte OKLCH de l'accent, un nombre), `-danger` (suppression), `-timeline` (rail et points sur le fond du site).

</GuideNote>

## Sans le panneau : créer depuis le popup

<GuideOp>

Pour éviter le nouveau chat, ou pour faire écrire le plugin par un autre chat ou une autre IA, partez de **Mes créations** dans le popup. **Créez le vôtre**, à la fin de la liste des plugins, vous amène à son premier champ.

</GuideOp>

<GuideSteps>
<GuideStep>

Écrivez une phrase sous **Que faut-il changer ?**. Le champ **Site** en dessous reprend le site de l'onglet actuel ; changez-le si le plugin vise un autre site.

</GuideStep>
<GuideStep>

Choisissez **Copier pour ce chat** et collez le message dans la conversation IA de ce site. L'IA lit la page de Voyager pour ce site, par exemple `https://voyager.nagi.fun/create/claude.md`, et répond avec un seul bloc de code JSON. L'IA doit pouvoir ouvrir des liens.

</GuideStep>
<GuideStep>

Collez la réponse complète sous **Collez la réponse de l’IA** et choisissez **Vérifier la réponse**.

</GuideStep>
<GuideStep>

Voyager explique en termes simples ce que le plugin modifie. Choisissez **Importer**, puis activez le plugin dans la liste des plugins ; sur Gemini et AI Studio, son interrupteur apparaît juste sous la carte. Un plugin importé de cette façon est désactivé au départ.

</GuideStep>
</GuideSteps>

<GuideOp>

Sur ce chemin, Voyager n'envoie rien lui-même. C'est vous qui collez le message et qui rapportez la réponse.

</GuideOp>

## Créations qui exécutent du code

<GuideOp>

Quand le CSS et les modifications de page ne suffisent pas, par exemple pour compter vos messages ou réagir à un clic, l'IA peut écrire une création qui exécute du JavaScript. Voyager l'exécute comme script utilisateur de Chrome, uniquement sur les sites qu'elle indique et uniquement après que vous avez lu son code. La revue signale une telle création par le badge **Exécute du code**.

</GuideOp>

### L'activer

<GuideOp>

- **La lire** : la revue indique les sites où elle s'exécute et affiche tout son code source. Elle peut lire tout ce qui se trouve sur ces pages, vos conversations comprises, et Voyager ne peut pas l'empêcher d'envoyer ailleurs ce qu'elle lit : n'installez que du code auquel vous faites confiance.
- **Installer et activer** : active exactement le code que vous avez lu. Si son code ou ses sites changent plus tard, elle se met en pause jusqu'à une nouvelle relecture, et l'interrupteur n'est jamais synchronisé avec vos autres appareils.
- **Réglage unique** : Chrome ne laisse une extension exécuter ce code qu'après votre autorisation. Choisissez **Ouvrir la page de détails de Voyager**, activez-y **Autoriser les scripts utilisateur** (Allow User Scripts ; avant Chrome 138, le **Mode développeur** en haut de `chrome://extensions`), puis revenez et choisissez **Je l’ai activé**.
- **Navigateurs** : Chrome ou Edge pour ordinateur, version 133 ou ultérieure. Sur Safari, Firefox et mobile, elle reste installée mais en pause ; demandez à l'IA une version qui change seulement l'apparence de la page.

</GuideOp>

### Garder la main

<GuideOp>

Dans **Mes créations**, chaque création qui exécute du code affiche **Activée, sur cet appareil uniquement**, **Désactivée** ou **En pause** avec la raison.

- **Tout arrêter** : **Arrêter toutes les créations qui exécutent du code**, en bas de **Mes créations** (la carte du popup ou l'onglet **Fonctions** du panneau), les arrête toutes d'un coup ; **Reprendre** les relance.
- **Pages ouvertes** : une page déjà ouverte continue de les exécuter jusqu'à son rechargement. **Recharger cette page** le fait pour l'onglet actuel.
- **Blocages** : si une page cesse de répondre après l'exécution de ces créations, Voyager les désactive et les nomme dans un avis au prochain chargement de la page. Une fois la création corrigée, relisez-la dans **Mes créations** et réactivez-la.

</GuideOp>

## Ce qu'il peut faire ou non

<GuideOp>

La plupart des créations ne changent que l'apparence et la mise en page de la page. Elles n'exécutent aucun code propre et annulent toutes leurs modifications quand vous les désactivez.

- **Possible** : changer le style de la page, en masquer des parties, ajouter des interrupteurs et des curseurs aux réglages, changer les couleurs de Voyager et, sur les sites à plugins, activer les fonctions intégrées de Voyager (copie des formules, chronologie, diagrammes Mermaid, etc.).
- **Avec du code** : réagir aux clics, compter des choses ou lire la page demande une création qui exécute du code, décrite plus haut.
- **Impossible pour toute création** : s'exécuter sur d'autres sites ou modifier les réglages de Voyager. Pour une telle demande, l'IA le dit et construit la version la plus proche qui fonctionne.
- **Toutes les règles** : les champs qu'un plugin peut utiliser et ce que l'import vérifie se trouvent dans [Écrire son propre plugin](./write-a-plugin.md#ce-qu-un-plugin-peut-faire).

</GuideOp>
