> _« Hier est derrière, demain est mystère, et aujourd'hui est un cadeau. » — Maître Oogway, 《Kung Fu Panda》 (2008)_

### Points forts

- 🎛️ **Panneau Voyager** : survolez le bouton flottant et cliquez sur l'entrée du panneau qui apparaît, ou appuyez sur ⌥V / Alt+V, pour ouvrir le panneau directement dans la page : activez ou désactivez les fonctions du site actuel sans quitter la conversation, faites glisser les curseurs avec un aperçu en direct, gérez l'accès aux sites et lancez la synchronisation cloud ; taper `/` dans la zone de saisie l'ouvre aussi. Le bouton flottant se masque désormais en un clic, et ⌥V le fait réapparaître.
- ☁️ **Synchronisation cloud plus sûre, téléchargements annulables** : quand un envoi risque de vider ou de réduire nettement vos données dans le cloud, ou que le fichier cloud est illisible, Voyager vous demande s'il faut fusionner, envoyer quand même ou annuler ; un téléchargement depuis le cloud s'annule en un clic ; avant chaque envoi, Drive conserve les 3 dernières versions remplacées pour que vous puissiez restaurer la précédente. La synchronisation cloud du panneau permet aussi de choisir les sites à synchroniser et affiche l'état de chacun.
- 🛰️ **Les correctifs de sites arrivent plus vite** : les repères de page de chaque site passent désormais par les mises à jour en ligne ; quand la refonte d'un site casse une fonction, elle peut être réparée sans attendre la validation des boutiques d'extensions ; un bouton d'actualisation à côté de l'interrupteur Mises à jour en ligne lance une vérification à la demande. Mises à jour en ligne désactivées, Voyager fonctionne uniquement avec sa version intégrée.

### Nouveautés

- **Carte Accès aux sites** : une nouvelle carte Accès aux sites dans le popup affiche l'accès de chaque site et les fonctions qui y sont activées, avec la possibilité d'annuler si vous retirez un accès ; sur :chatgpt: ChatGPT, :claude: Claude, :deepseek: DeepSeek et :kimi: Kimi, le gestionnaire de prompts devient un interrupteur dans la liste des fonctions du site.
- **Bouton d'export déplaçable** : faites glisser le bouton d'export flottant où vous voulez ; chaque site mémorise sa position, et le déposer près de sa position par défaut l'y remet automatiquement.
- **L'app Safari dans votre langue Voyager** : la fenêtre, les menus et les notifications de l'app Voyager sur macOS utilisent la langue choisie dans Voyager, et l'interface s'affiche en miroir en arabe.
- **:chatgpt: ChatGPT liste les fichiers envoyés dans l'export** : les fichiers envoyés dans une conversation apparaissent dans l'export sous la forme d'une ligne « 📎 nom du fichier ».

### Corrections

- **Export avec tout sélectionné d'emblée** : une fois la conversation entière lue, tous les messages sont sélectionnés, au lieu de « 0 sélectionné » avec le bouton Exporter grisé.
- **:chatgpt: ChatGPT n'exporte plus de PDF vides** : l'export PDF s'adapte à la nouvelle façon d'imprimer de ChatGPT et affiche de nouveau la conversation.
- **:chatgpt: Avertissement clair quand l'historique ChatGPT est illisible** : quand l'export ne parvient pas à lire tout l'historique, il le dit et vous propose de remonter pour le charger avant de réessayer, au lieu de vous laisser attendre.
- **:chatgpt: ChatGPT cesse d'afficher le guide des dossiers en boucle** : le guide n'apparaît plus chaque fois que la barre latérale repliée se déploie au survol ; il attend qu'elle soit fixée ouverte.
- **Le bouton d'export ne gêne plus les contrôles de la page** : le bouton d'export s'écarte des boutons du site, comme le bouton Partager de la barre supérieure de :claude: Claude, et passe derrière les boîtes de dialogue du site.
- **:claude: Claude en mode sombre** : quand Claude passe en mode sombre, l'interface de Voyager suit.
- **Rendu Mermaid plus sûr** : les diagrammes sont rendus dans une page séparée et isolée qui ne charge aucune image ni police externe, et un rendu échoué est relancé automatiquement.
- **Une synchro échouée n'envoie plus de données partielles** : si la lecture des données du cloud ou locales échoue, l'envoi s'arrête avant d'écrire quoi que ce soit ; synchroniser depuis deux endroits à la fois ne les fait plus s'écraser l'un l'autre, et les messages d'échec en donnent la raison.
- **Le téléchargement avec écrasement n'efface plus les données** : les données absentes ou illisibles dans le cloud restent telles quelles en local, et une liste d'extensions vide dans le cloud n'efface plus vos extensions.
- **Connexion Drive et changement de compte sur Safari** : après avoir connecté Google Drive dans l'app Voyager, le popup l'affiche aussitôt comme connecté ; après un changement de compte, la synchronisation suit le nouveau compte, et changer de compte en pleine synchronisation l'arrête au lieu de mélanger les données de deux comptes.
- **Les sauvegardes ne gardent que les réglages modifiés** : les fichiers de réglages exportés et ceux de Drive ne contiennent que ce que vous avez réellement modifié, si bien qu'une restauration n'écrase plus les choix d'un autre appareil par des valeurs par défaut ; les réglages propres à l'appareil, comme la position du panneau et des boutons, ne sont plus synchronisés.
- **Les extensions fonctionnent à nouveau sur Android** : sur les navigateurs Android comme Edge, les extensions n'indiquent plus qu'elles ne sont pas prises en charge sur mobile, et les réglages des dossiers comme la synchronisation Google Drive fonctionnent de nouveau.
- **Aperçus au survol plus faciles à atteindre** : se diriger en diagonale vers l'aperçu au survol d'un prompt ne le fait plus basculer sur les lignes traversées en chemin.
- **Traductions corrigées** : les messages de synchronisation du panneau des dossiers ne s'affichent plus en anglais, et les boutons de synchronisation cloud du gestionnaire de prompts ne débordent plus en russe.
- **Moins de mémoire** : Voyager ne charge que la langue que vous utilisez, et chaque page consomme moins de mémoire.

Avec l'isolation des comptes activée, les fichiers Drive de chaque compte sont désormais nommés d'après son adresse e-mail. Mettez tous vos appareils à jour vers cette version, sinon les plus anciens ne verront pas les nouveaux envois.
