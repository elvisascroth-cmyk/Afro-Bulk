# AFRO BULK — boutique en ligne

Site de vente de compléments alimentaires naturels fabriqués à Lomé (Togo).
HTML, CSS et JavaScript purs : aucun build, aucune dépendance. Prêt pour Vercel.

## Voir le site sur le téléphone

```bash
cd /root/.buddy/work/afro
node serve.js 8080
```

Puis ouvrir **http://localhost:8080** dans Chrome.
Arrêter le serveur : `Ctrl+C` (ou `pkill -f "node serve.js"`).

Le serveur local est nécessaire pour les mots de passe (Web Crypto) et l'installation
en application ; en `file://` certaines fonctions sont bloquées.

## Déployer sur Vercel

Trois méthodes, de la plus simple à la plus complète.

### 1. Glisser-déposer (le plus rapide)

1. Ouvrir <https://vercel.com/new> et se connecter.
2. Choisir « Deploy » sans dépôt Git, puis glisser le dossier `afro`.
3. Vercel donne une adresse du type `https://afro-bulk.vercel.app`.

### 2. Depuis GitHub (recommandé pour les mises à jour)

```bash
cd /root/.buddy/work/afro
git init && git add . && git commit -m "AFRO BULK"
# créer un dépôt vide sur GitHub, puis :
git remote add origin https://github.com/<compte>/afro-bulk.git
git push -u origin main
```

Sur Vercel : « Add New Project » → importer le dépôt → Deploy.
Chaque `git push` redéploie automatiquement.

### 3. En ligne de commande

```bash
cd /root/.buddy/work/afro
npx vercel login     # une seule fois
npx vercel --prod
```

`vercel.json` contient déjà les en-têtes de sécurité (CSP, anti-clickjacking,
nosniff, cache des images) et les URLs propres.

Après le déploiement, remplacer le domaine d'exemple dans `sitemap.xml` et
`robots.txt` par l'adresse réelle.

## Espace admin

Lien « Espace admin » en bas de page, ou **/#admin**.

- Première visite : c'est vous qui créez le mot de passe admin (8 caractères minimum).
  Aucun mot de passe n'est écrit dans le code.
- Ensuite : mot de passe demandé, verrouillage 5 minutes après 5 essais ratés.
- Mot de passe oublié = impossible à retrouver (haché). Il faut effacer les données du
  site dans le navigateur, ce qui efface aussi comptes et commandes : exportez avant.

| Section | Fonctions |
|---|---|
| Tableau de bord | commandes, chiffre d'affaires, en attente, stock, ventes des 7 derniers jours |
| Commandes | filtre par statut, changement de statut, preuve de paiement, message WhatsApp au client |
| Produits | nom, prix, stock, disponibilité, photo (URL ou fichier), réinitialisation |
| Livraison | tarif Lomé, tarif intérieur, seuil de livraison offerte |
| Sauvegarde | export JSON complet, export CSV des commandes, import d'une sauvegarde |

Le stock est décrémenté à la commande et remis en place si elle est annulée.

## Comment les commandes arrivent au commerce

Le site fonctionne sans serveur : les données (comptes, commandes, produits) sont
stockées dans le navigateur de l'appareil (`localStorage`). C'est volontaire pour
démarrer sans frais et sans base de données.

Concrètement, pour un client :

1. il crée un compte, commande et joint sa référence de paiement ou une capture ;
2. le site affiche « Envoyer sur WhatsApp » : le récapitulatif part sur le
   +228 79 41 37 79, ce qui vaut commande ferme ;
3. vous traitez la commande depuis l'admin de votre propre téléphone.

**Limite à connaître** : le tableau de bord admin ne voit que les commandes passées
sur le même navigateur. Pour centraliser toutes les commandes de tous les clients,
il faut une base de données en ligne (Supabase ou Neon, gratuits) et une API
serverless : c'est la prochaine étape, le site est déjà structuré pour cela
(une seule couche `loadDB` / `saveDB` à remplacer).

## Sécurité

- Mots de passe hachés en **PBKDF2-SHA256, 120 000 itérations**, sel aléatoire, comparaison à temps constant.
- Sessions expirantes : client 24 h, admin 8 h.
- Verrouillage temporaire après 5 tentatives (client et admin).
- **CSP stricte** (`script-src 'self'`), en-têtes Vercel, `frame-ancestors 'none'`, `no-referrer`.
- Échappement systématique du contenu dynamique (XSS).
- Images limitées à `https://`, fichier local connu ou base64 png/jpeg/webp/gif/avif, 1,5 Mo maximum.
- Liens externes en `noopener noreferrer`.

## SEO et partage

- Balises Open Graph et Twitter, description, titre optimisés.
- `robots.txt`, `sitemap.xml`, page `404.html`.
- Données structurées volontairement absentes (CSP sans script inline).

## Personnaliser

- Couleurs et espacements : variables `:root` en haut de `styles.css`.
- Textes : `index.html`.
- Produits, prix, stock : `defaultDB()` dans `app.js`, ou directement via l'admin.
- Photos : remplacer `bulk.jpg` et `fit.jpg`, ou passer par l'admin.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | structure, textes, vues boutique / compte / admin |
| `styles.css` | thème sombre, composants, responsive |
| `app.js` | boutique, panier, comptes, commandes, admin, sécurité |
| `serve.js` | serveur local de test |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | installation en application + hors ligne |
| `vercel.json` | configuration de déploiement et en-têtes |
| `robots.txt`, `sitemap.xml`, `404.html` | référencement et page d'erreur |
| `bulk.jpg`, `fit.jpg` | photos produits |
| `compact.html` | ancienne version, non référencée (exclue de l'indexation) |
