# Dossiers

Rangez vos conversations dans des dossiers de la barre latérale : glissez-en une dans un dossier et elle est classée, imbriquez les dossiers sur trois niveaux et retrouvez les mêmes sur un autre appareil. Les dossiers fonctionnent sur ordinateur et sur téléphone Android.

<SiteSupport feature="folders" :labels="{ folders: 'Dossiers dans la barre latérale', 'hide-filed': 'Masquer les conversations classées', activity: 'Vue Activity', 'account-isolation': 'Isolation des comptes', projects: 'Dossiers comme projets', 'ai-organize': 'Organiser par IA', 'move-menu': '**Déplacer vers un dossier** dans le menu', 'library-drag': 'Glisser depuis le tableau Library', 'gem-icons': 'Icônes selon le type de Gem' }" :only="[{ id: 'move-menu', sites: ['gemini', 'chatgpt', 'claude'] }, { id: 'library-drag', sites: ['aistudio'] }, { id: 'gem-icons', sites: ['gemini'] }]" />

<GuideHero src="/assets/gemini-folders.png" alt="La section des dossiers dans la barre latérale">

La section des dossiers se trouve au-dessus de la liste des conversations, dans la barre latérale. Quand la barre latérale est fermée, les mêmes dossiers restent disponibles dans un panneau flottant.

</GuideHero>

## Classer une conversation

<GuideOp>

Toute conversation de la barre latérale peut aller dans un dossier, et une même conversation peut se trouver dans plusieurs.

- **Glisser** : faites glisser une conversation de la barre latérale sur un dossier.
- **Menu de la conversation** : sur les sites qui le permettent, ouvrez le menu de la conversation et choisissez **Déplacer vers un dossier**.
- **Sélection multiple** : appuyez longuement sur une conversation d’un dossier pour en sélectionner plusieurs, puis déplacez-les d’un coup.
- **AI Studio** : la barre latérale ne gère pas encore la sélection multiple ; vous pouvez glisser des conversations depuis le tableau Library vers un dossier.

</GuideOp>

## Imbriquer et renommer

<GuideOp side="end">

<GuideShot src="/assets/folders-nested-en.png" alt="Dossiers imbriqués sur trois niveaux" :width="240" />

Les dossiers vont jusqu’à trois niveaux : un dossier de premier niveau peut contenir deux niveaux de sous-dossiers.

- **Sous-dossier** : faites un clic droit sur un dossier et créez un sous-dossier depuis le menu.
- **Renommer** : double-cliquez sur le nom du dossier, ou choisissez **Renommer** dans son menu contextuel.
- **Replier** : cliquez sur la flèche devant un dossier pour replier ou déplier son contenu.

</GuideOp>

### Menu et couleurs

<GuideOp side="end">

<GuideShot src="/assets/folders-menu-en.png" alt="Le menu contextuel d’un dossier et ses couleurs" :width="254" />

Faites un clic droit sur un dossier : tout ce que vous pouvez en faire est dans le menu.

- **Épingler** : garde le dossier tout en haut.
- **Couleur** : choisissez l’une des 7 couleurs.
- **Supprimer** : efface le dossier et tout son contenu, après confirmation.

</GuideOp>

<GuideNote>

**Affichage** : la roue dentée de l’en-tête des dossiers change l’ordre des conversations (ordre manuel ou ouvertes récemment) et règle la taille du texte, l’espacement des dossiers et le retrait des sous-dossiers ; le réglage **Espacement des dossiers** de la fenêtre le fait aussi. Sur Safari pour Mac, il faut parfois actualiser la page pour voir le changement.

</GuideNote>

## Masquer les conversations classées

<GuideOp>

Une fois une conversation dans un dossier, vous pouvez la retirer de la liste principale pour n’y garder que les conversations en cours.

- **Gemini et AI Studio** : ouvrez la fenêtre → **Options des dossiers** → **Masquer les discussions archivées**. Chaque site garde son propre réglage ; sur AI Studio, ce sont les lignes du tableau Library qui sont masquées.
- **Premier classement** : sur ces deux sites, la première fois que vous classez une conversation, une carte dans la section des dossiers propose de l’activer en un clic. Choisissez **Pas maintenant** et elle ne reviendra pas.
- **Autres sites** : l’interrupteur se trouve dans les réglages du plugin des dossiers, zone **Extensions** de la fenêtre ; il est désactivé par défaut.
- **Rien n’est supprimé** : les conversations classées restent dans leurs dossiers, et vous pouvez désactiver l’option à tout moment.

</GuideOp>

## Synchroniser et déplacer

<GuideFacts>
<GuideFact title="Importer et exporter">

L’icône de dossier de l’en-tête propose **Importer dossiers** et **Exporter dossiers**. L’export enregistre un fichier JSON ; l’import le fusionne avec vos dossiers existants, sans défaire ce que vous avez déjà classé.

<GuideShot src="/assets/folders-transfer-en.png" alt="Importer et exporter des dossiers" :width="160" />

</GuideFact>
<GuideFact title="Isolation des comptes">

Le bouton en forme de personne dans la barre latérale de Gemini n’affiche temporairement que les conversations du compte Google actuel ; il est désactivé par défaut. **Enable Hard Isolation**, dans **Options des dossiers** de la fenêtre, sépare les dossiers et les données de synchronisation par compte, et le bouton se masque alors.

</GuideFact>
<GuideFact title="Synchronisation cloud">

Chaque site qui a des dossiers peut utiliser la synchronisation cloud pour retrouver les mêmes dossiers sur un autre ordinateur. Les dossiers de chaque site sont enregistrés et synchronisés séparément.

[Configurer la synchronisation](/fr/guide/cloud-sync)

</GuideFact>
<GuideFact title="Vue Activity">

La cloche de l’en-tête remplace l’arborescence par une vue Activity en lecture seule, qui liste les conversations des derniers jours par dernière activité réelle ; appuyez de nouveau pour revenir à l’arborescence. Elle ne déplace, ne copie et ne reclasse aucune conversation.

[Lire le guide complet de la vue Activity](/fr/guide/activity-view)

</GuideFact>
</GuideFacts>

## Organiser par IA

Trop de conversations à trier à la main ? Laissez Gemini proposer un plan de dossiers.

<GuideSteps>
<GuideStep>

Ouvrez la fenêtre sur Gemini et cliquez sur **Organiser par IA** en bas de **Options des dossiers**. Vos conversations non classées et la structure actuelle des dossiers sont copiées sous forme de prompt ; le prompt et les noms de dossiers sont dans votre langue.

<GuideShot kind="panel" src="/assets/ai-auto-folder.png" alt="Le bouton Organiser par IA dans la fenêtre" :width="326" />

</GuideStep>
<GuideStep>

Collez le prompt dans Gemini. Il répond avec un plan de dossiers en JSON.

</GuideStep>
<GuideStep>

Cliquez sur **Importer dossiers** dans l’en-tête, choisissez **Ou coller le JSON directement**, collez, puis cliquez sur **Importer**. **Fusionner** est le choix par défaut : seuls les nouveaux dossiers et les nouveaux classements sont ajoutés, le reste ne bouge pas.

</GuideStep>
</GuideSteps>

## Dossiers comme projets

Donnez à un dossier des instructions de premier tour : une nouvelle conversation s’y range d’elle-même après son premier message. L’idée vient de Claude Projects, mais Voyager se limite aux instructions de premier tour et au classement automatique ; ce n’est pas un espace de travail au contexte partagé.

<GuideSteps>
<GuideStep>

Activez **Activer Dossier comme Projet** dans la fenêtre.

</GuideStep>
<GuideStep>

Faites un clic droit sur un dossier et choisissez **Définir les instructions** ou **Modifier les instructions**.

</GuideStep>
<GuideStep>

Ouvrez une nouvelle conversation Gemini et choisissez le dossier dans le sélecteur à côté du champ de saisie.

</GuideStep>
<GuideStep>

Envoyez votre premier message.

</GuideStep>
</GuideSteps>

<GuideNote>

**Ensuite**

- Après le premier envoi, la conversation est classée dans ce dossier.
- Si le dossier a des instructions, Voyager ne les ajoute qu’à ce premier envoi. Sans instructions, le dossier sert de raccourci pour classer les nouvelles conversations.
- Les conversations d’un même dossier ne partagent **pas** de mémoire et ne lisent pas le contenu des autres.
- L’enregistrement automatique du brouillon ne garde que ce que vous avez tapé, jamais les instructions cachées.

</GuideNote>

Pour la largeur de la barre latérale, voir [Largeur de la barre latérale](/fr/guide/sidebar).
