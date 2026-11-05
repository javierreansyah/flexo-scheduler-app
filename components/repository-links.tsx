const REPOSITORY = "https://github.com/javierreansyah/flexo-scheduler-app";
const LINKS = [
  { title: "Source code", href: REPOSITORY },
  { title: "Report an issue", href: REPOSITORY + "/issues" },
];

export default function RepositoryLinks() {
  return (
    <nav aria-label="Project repository">
      <ul className="m-0 list-none text-sm">
        {LINKS.map((item) => (
          <li key={item.href} className="border-b border-border">
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-4 py-4 text-foreground hover:text-muted-foreground"
            >
              <span className="group-hover:underline">{item.title}</span>
              <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
