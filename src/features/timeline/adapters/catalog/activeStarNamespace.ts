/** The star namespace a mounted catalog timeline reads and writes on this page. */
export interface StarNamespace {
  readonly siteId: string;
  readonly conversationIdPattern?: string;
}

/** Mounted timelines, oldest first; each entry lives exactly as long as its plugin scope. */
const mounted: StarNamespace[] = [];

/** Publishes a mounted timeline's namespace; the returned function withdraws it on unmount. */
export function publishStarNamespace(namespace: StarNamespace): () => void {
  mounted.push(namespace);
  return () => {
    const index = mounted.lastIndexOf(namespace);
    if (index >= 0) mounted.splice(index, 1);
  };
}

/** The namespace the site's newest mounted timeline files stars under, if one is mounted. */
export function activeStarNamespace(siteId: string): StarNamespace | undefined {
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (mounted[index].siteId === siteId) return mounted[index];
  }
  return undefined;
}
