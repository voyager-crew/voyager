# Mode création

Dites en une phrase ce que vous voulez changer sur un site, par exemple « rends mes messages plus étroits ». L'IA de ce site fait le changement pour vous, et Voyager le vérifie avant de l'installer. Inutile de connaître le code, et vous restez sur la page. Cela marche sur Gemini, AI Studio, ChatGPT, Claude, DeepSeek et Kimi.

Ce que vous fabriquez s'appelle une création. C'est un petit plugin qui reste uniquement dans ce navigateur. Vous pouvez le désactiver ou le supprimer quand vous voulez.

<GuideHero src="/assets/create-mode-hero-en-light.png" dark="/assets/create-mode-hero-en-dark.png" alt="Le panneau Voyager ouvert sur un site d’IA, sur l’onglet Créer, avec une demande d’une phrase saisie">

Le mode création a deux points d'entrée. Le premier est l'onglet **Créer** du [panneau Voyager](./panel.md), sur la page. Le second est la carte **Mes créations** dans le popup de Voyager. Le popup, c'est la petite fenêtre qui s'ouvre quand vous cliquez sur l'icône de Voyager dans la barre d'outils du navigateur.

</GuideHero>

## Créer sur la page

<GuideOp>

Le plus rapide est de le faire sur le site d'IA que vous voulez changer. Ouvrez-y le panneau Voyager et choisissez **Créer**.

<GuideShot kind="panel" src="/assets/create-mode-ask-en.png" alt="L’onglet Créer : la zone pour une phrase, l’interrupteur de structure de la page et les boutons pour copier vers un agent local et créer sur cette page" :width="632" />

</GuideOp>

<GuideSteps>
<GuideStep>

Écrivez une phrase sous **Que faut-il changer ?**, par exemple « Rends mes messages plus étroits et masque la barre latérale ». Choisissez ensuite **Créer sur cette page**.

</GuideStep>
<GuideStep>

Voyager ouvre une nouvelle conversation sur ce site et écrit votre demande dans la zone de saisie. Relisez-la, puis appuyez vous-même sur envoyer. Voyager n'envoie jamais rien à votre place. Si la zone de saisie contient déjà du texte, Voyager n'y touche pas. Il vous demande d'abord de l'envoyer ou de l'effacer.

</GuideStep>
<GuideStep>

Quand l'IA a répondu, un bouton de Voyager apparaît sous sa réponse : **Aperçu et installation**.

<GuideShot src="/assets/create-mode-reply-en.png" alt="Le bouton Voyager Aperçu et installation, sous une réponse de l’IA" :width="267" />

</GuideStep>
<GuideStep>

Choisissez-le. Le panneau montre ce que la création va changer, les sites où elle fonctionne et les points notés sous **À vérifier**. Si tout vous convient, choisissez **Installer et activer**. Le changement apparaît aussitôt. Si vous n'en voulez plus, désactivez-la dans l'onglet **Fonctions** du panneau.

<GuideShot kind="panel" src="/assets/create-mode-review-en.png" alt="La revue dans le panneau : nom de la création, ses sites, ce qu’elle change, les points à vérifier et le bouton pour installer et activer" :width="632" />

</GuideStep>
</GuideSteps>

<GuideOp>

Pour la modifier encore, continuez à parler à l'IA dans la même conversation.

- **Une nouvelle version** : **Aperçu de la mise à jour** apparaît sous la nouvelle réponse de l'IA. Regardez-la, puis choisissez **Mettre à jour et activer**. Les anciennes réponses indiquent **Version précédente**.
- **Déjà installée** : la réponse que vous avez installée indique **Installé**.
- **Seulement dans ces conversations** : les boutons n'apparaissent que dans une conversation lancée avec **Créer sur cette page**. Pour toute autre conversation, passez par « Créer depuis le popup », plus bas.

</GuideOp>

## Laisser l'IA voir la page

<GuideOp>

L'onglet **Créer** a un seul interrupteur : **Ajouter la structure de cette page, sans aucun de ses textes, pour que l’IA écrive pour ce qui s’y trouve**. Il est activé par défaut.

- **Ce qui est ajouté** : la disposition de la page. Autrement dit, ses boutons, ses zones de saisie, ses zones de messages et leur place. Grâce à ça, l'IA n'a pas besoin de deviner.
- **Ce qui n'est jamais ajouté** : aucun texte de la page, pas même vos conversations. Ni adresse web, ni information de compte.
- **Voir par vous-même** : choisissez **Voir ce qui est ajouté**. Vous voyez tout ce qui partira vers l'IA.
- **Ne rien ajouter** : désactivez l'interrupteur. La demande ne contient alors que votre phrase.

<GuideShot kind="panel" src="/assets/create-mode-structure-en.png" alt="Ce qui est joint, déplié : la structure de la page en noms et nombres de ses parties, sans aucun texte" :width="612" />

</GuideOp>

## L'avertissement sur le modèle dans Gemini

<GuideOp>

Gemini propose plusieurs modèles. Flash et Flash-Lite sont des modèles plus légers. En général, ils n'arrivent pas à faire une création qui marche. Si la nouvelle conversation doit utiliser l'un d'eux, le haut de l'onglet **Créer** vous prévient.

- **Que faire** : l'avertissement indique un meilleur modèle. Choisissez-le dans le menu des modèles de Gemini, puis choisissez **Vérifier à nouveau**.
- **Une autre solution** : choisissez **Copier pour un agent local** dans l'avertissement. Le travail part alors vers un assistant de programmation installé sur votre ordinateur. Voir [Écrire son propre plugin](./write-a-plugin.md).
- **Rien n'est bloqué** : ce n'est qu'un avertissement. **Créer sur cette page** marche toujours.

<GuideShot kind="panel" src="/assets/create-mode-model-en.png" alt="L’avis en haut de l’onglet Créer indiquant que Flash de Gemini écrit rarement un plugin, avec les boutons pour revérifier et copier vers un agent local" :width="616" />

</GuideOp>

## Quand ça ne s'installe pas

<GuideOp>

L'IA ne réussit pas toujours du premier coup. Dans ce cas, une ligne sous la réponse explique pourquoi, par exemple « Il n’indique pas sur quel site il s’applique ».

- **Lui demander de corriger** : choisissez **Lui demander de corriger** sous la réponse. Voyager écrit les problèmes dans la zone de saisie, et c'est vous qui envoyez.
- **Une fois corrigé** : quand l'IA envoie une version corrigée, **Aperçu et installation** réapparaît dessous.
- **Rien ne change en attendant** : une création qui n'a pas été installée ne touche pas à votre page.

<GuideShot src="/assets/create-mode-rejected-en.png" alt="La ligne sous une réponse de l’IA indiquant que le plugin ne peut pas être installé car il ne précise pas le site, avec le bouton Lui demander de corriger" :width="624" />

</GuideOp>

## Après l'installation

<GuideOp>

Tout ce que vous avez installé se trouve dans **Mes créations**.

- **Dans le panneau** : le groupe **Mes créations** de l'onglet **Fonctions**. Chaque création a sa ligne, avec son propre interrupteur.
- **Dans le popup** : sur Gemini et AI Studio, c'est une carte. Elle se trouve sous **Synchro Cloud**, sauf si vous la déplacez. **Aller à**, en haut du popup, vous y emmène. Sur les autres sites, elle se trouve sous la liste des plugins.
- **Supprimer** : choisissez l'icône de corbeille sur sa ligne, puis confirmez. Impossible de revenir en arrière.
- **L'emporter dans un autre navigateur** : dans **Mes créations** du popup, choisissez **Exporter** sur la création. Vous obtenez un fichier. Importez ce fichier dans l'autre navigateur.
- **La partager avec tout le monde** : si elle peut servir à d'autres, vous pouvez la proposer à Voyager. [Contribution Plugins](./plugin-contribution.md) explique comment faire.

</GuideOp>

### La vérification automatique

<GuideOp>

À chaque ouverture du panneau, Voyager regarde si vos créations font quelque chose sur la page actuelle.

- **Ne marche pas ici** : une création est activée, mais elle ne trouve rien à changer sur cette page. Sa ligne indique alors **Activé, mais rien sur cette page ne lui correspond**. Cela arrive souvent quand un site change de look.
- **La page s'est figée** : une création qui exécute du code a bloqué la page. Voyager l'a déjà désactivée, et sa ligne explique pourquoi.
- **Demander une correction** : dans les deux cas, **Demander une correction** est proposé. Choisissez-le. Voyager ouvre une nouvelle conversation avec le problème déjà écrit. Le panneau se ferme pour que vous puissiez le relire et appuyer sur envoyer.

<GuideShot kind="panel" src="/assets/create-mode-creations-en.png" alt="Mes créations dans l’onglet Fonctions : une création est activée mais rien sur cette page ne lui correspond, avec le bouton Demander une correction" :width="414" />

</GuideOp>

## Changer les couleurs de Voyager

<GuideOp>

Une création peut aussi changer les couleurs de Voyager lui-même. Il suffit de le dire, par exemple « donne à Voyager les couleurs Nord ».

- **Ce qui change** : les panneaux, les menus, les fenêtres, les petits messages qui s'affichent et la chronologie de Voyager. En mode clair comme en mode sombre.
- **Ce qui ne change pas** : les couleurs du site lui-même, ni le texte que Voyager écrit directement sur la page du site. Ainsi, ce texte ne se confond jamais avec le fond du site. Le popup de Voyager ne change pas non plus.
- **Pour revenir en arrière** : désactivez la création. Les couleurs d'origine reviennent.

</GuideOp>

## Créer depuis le popup

<GuideOp>

Vous voulez éviter la nouvelle conversation, ou confier le travail à une autre conversation ou à une autre IA ? Partez de **Mes créations** dans le popup. **Créez le vôtre**, en bas de la liste des plugins, vous y emmène.

</GuideOp>

<GuideSteps>
<GuideStep>

Écrivez une phrase sous **Que faut-il changer ?**. Juste en dessous, **Site** indique au départ le site où vous êtes. Changez-le si la création est pour un autre site.

</GuideStep>
<GuideStep>

Choisissez **Copier pour ce chat**. Collez ensuite le texte copié dans la conversation avec l'IA de ce site, puis envoyez-le.

</GuideStep>
<GuideStep>

Quand l'IA a répondu, copiez toute sa réponse. Collez-la sous **Collez la réponse de l’IA**, puis choisissez **Vérifier la réponse**.

</GuideStep>
<GuideStep>

Voyager vous dit avec des mots simples ce qui va changer. Choisissez **Importer**, puis activez la création dans la liste des plugins. Une création ajoutée de cette façon est désactivée au départ.

</GuideStep>
</GuideSteps>

<GuideOp>

Sur ce chemin, Voyager n'envoie rien lui-même. C'est vous qui collez le texte, et vous qui rapportez la réponse.

</GuideOp>

## Créations qui exécutent du code

<GuideOp>

La plupart des créations changent seulement l'apparence. Certaines demandes vont plus loin, par exemple compter vos messages ou faire quelque chose quand vous cliquez. Pour celles-là, l'IA fait une création qui exécute du code. L'aperçu la signale par la mention **Exécute du code**.

</GuideOp>

### L'activer

<GuideOp>

- **Regardez d'abord** : l'aperçu indique les sites où elle fonctionne et montre tout son code. Elle peut voir tout ce qui se trouve sur ces pages, vos conversations comprises. Voyager ne peut pas l'empêcher d'envoyer ailleurs ce qu'elle voit. N'activez donc que les créations auxquelles vous faites confiance.
- **Installer et activer** : active exactement la version que vous venez de regarder. Si l'IA en fait une nouvelle version, celle-ci reste désactivée jusqu'à ce que vous la regardiez à son tour. L'interrupteur ne vaut que pour cet appareil.
- **Un réglage à faire une seule fois** : le navigateur doit autoriser Voyager à faire tourner ces créations. Choisissez **Ouvrir la page de détails de Voyager** et activez **Autoriser les scripts utilisateur** (Allow User Scripts). Revenez ensuite et choisissez **Je l’ai activé**.
- **Navigateurs** : Chrome ou Edge sur ordinateur, version 133 ou plus récente. Sur Safari, Firefox et téléphone, la création reste installée mais en pause. Vous pouvez demander à l'IA une version qui change seulement l'apparence de la page.

<GuideShot kind="panel" src="/assets/create-mode-scripted-en.png" alt="La revue d’une création qui exécute du code : la mention Exécute du code, l’avertissement, le code complet et les étapes Allow User Scripts" :width="632" />

</GuideOp>

### Garder la main

<GuideOp>

Dans **Mes créations**, chaque création qui exécute du code indique **Activée, sur cet appareil uniquement**, **Désactivée** ou **En pause**. Quand elle est en pause, la raison est indiquée.

- **Tout arrêter** : choisissez **Arrêter toutes les créations qui exécutent du code**, en bas de **Mes créations**. Choisissez **Reprendre** pour les relancer.
- **Pages déjà ouvertes** : elles continuent de tourner jusqu'à ce que vous rechargiez la page. **Recharger cette page** recharge la page actuelle.
- **Une page figée** : si une page se bloque à cause d'elles, Voyager les désactive. À la prochaine ouverture de la page, un message vous dit lesquelles.

</GuideOp>

## Ce qu'il peut faire ou non

<GuideOp>

- **Possible** : changer l'apparence d'une page, comme la largeur, la taille du texte ou les couleurs. Masquer ce que vous ne voulez pas voir. Ajouter des interrupteurs et des curseurs aux réglages. Changer les couleurs de Voyager. Sur certains sites, une création peut aussi activer des fonctions de Voyager, comme la copie des formules et la chronologie.
- **Avec du code** : faire quelque chose au clic, compter des choses, lire ce qu'il y a sur la page. Voir « Créations qui exécutent du code » plus haut.
- **Impossible** : fonctionner sur d'autres sites, ou modifier les réglages de Voyager. Pour une telle demande, l'IA le dit et fait la version la plus proche possible.

</GuideOp>

## Les détails

<GuideOp>

Cette section s'adresse à ceux qui veulent savoir comment ça marche en coulisses. Passez-la si vous voulez seulement vous en servir.

- **Ce qu'est une création** : un plugin local, fait d'un manifest de plugin et de styles. Pour en écrire un à la main, lire les règles ou trouver les variables de couleur qui servent à changer les couleurs de Voyager, voir [Écrire son propre plugin](./write-a-plugin.md).
- **Ce que lit l'IA** : la demande contient un lien vers les consignes de Voyager pour le site, par exemple `https://voyager.nagi.fun/create/claude.md`. L'IA répond avec un seul bloc de code JSON. Voyager n'affiche ses boutons que dans une conversation dont le message contient ce lien. Avec le popup, l'IA doit donc pouvoir ouvrir des liens.
- **La structure de la page** : les éléments de page que Voyager reconnaît et leur nombre, et l'arbre des éléments autour de la dernière réponse et de votre dernier message. Aucun texte ni adresse web. Les valeurs d'attribut qui ressemblent à des identifiants, des e-mails ou de longs nombres sont aussi retirées.
- **L'avertissement sur le modèle** : Voyager lit le modèle que recevra la nouvelle conversation. Si [Modèle par Défaut](./default-model.md) est activé, il se fie à ce modèle par défaut. Il vérifie à nouveau quand vous revenez au panneau.
- **La vérification automatique** : Voyager regarde seulement si les styles et les modifications de page de la création trouvent quelque chose sur la page actuelle. Les états de survol et de focus ne comptent pas, pas plus que les créations qui ne font qu'appeler des fonctions intégrées.
- **L'exécution du code** : elle passe par les scripts utilisateur de Chrome, et seulement sur les sites que la création indique. Avant Chrome 138, l'interrupteur est le **Mode développeur**, en haut de `chrome://extensions`.

</GuideOp>
