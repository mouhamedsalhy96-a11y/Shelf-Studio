"use client";

import Image from "next/image";
import Link from "next/link";
import GenerationPanel from "@/components/generation-panel";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  FileText,
  FolderOpen,
  ImagePlus,
  Layers2,
  Leaf,
  LoaderCircle,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { listDrafts, saveDraft, type Draft, type SceneId } from "@/lib/drafts";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/browser";
import {
  listAccountProjects,
  openAccountProject,
  saveAccountProject,
  type ProjectSummary,
} from "@/lib/account-projects";

const scenes = [
  {
    id: "studio" as const,
    name: "Clean studio",
    description: "Soft light. Simple surroundings.",
    image: "/images/studio.jpg",
    icon: Sun,
  },
  {
    id: "lifestyle" as const,
    name: "Everyday living",
    description: "A natural, lived-in setting.",
    image: "/images/lifestyle.jpg",
    icon: Leaf,
  },
  {
    id: "seasonal" as const,
    name: "Seasonal mood",
    description: "A little occasion. A little colour.",
    image: "/images/seasonal.jpg",
    icon: Sparkles,
  },
];
const ratios = ["1:1", "4:5", "16:9"] as const;
type Tab = "workspace" | "projects";
type PreviewTab = "image" | "brief";

function DraftCard({ draft, onOpen }: { draft: Draft; onOpen: () => void }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(draft.image);
    // The preview URL is an external browser resource with a matching cleanup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImage(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.image]);
  return (
    <button className="draft-card" onClick={onOpen}>
      <div className="draft-image">
        {image && (
          <Image
            src={image}
            alt={draft.name || "Saved product"}
            fill
            unoptimized
            sizes="(max-width: 700px) 90vw, 350px"
          />
        )}
      </div>
      <div className="draft-card-copy">
        <span>{scenes.find((scene) => scene.id === draft.scene)?.name}</span>
        <h3>{draft.name || "Untitled product"}</h3>
        <p>
          {new Date(draft.updatedAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          <ArrowRight size={16} />
        </p>
      </div>
    </button>
  );
}

function AccountProjectCard({
  project,
  disabled,
  onOpen,
}: {
  project: ProjectSummary;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button className="draft-card" disabled={disabled} onClick={onOpen}>
      <div className="draft-image">
        {project.thumbnailUrl ? (
          <Image
            src={project.thumbnailUrl}
            alt={project.name}
            fill
            unoptimized
            sizes="(max-width: 700px) 90vw, 350px"
          />
        ) : (
          <ImagePlus size={32} aria-label="Photo preview unavailable" />
        )}
      </div>
      <div className="draft-card-copy">
        <span>
          Saved to your account ·{" "}
          {scenes.find((scene) => scene.id === project.scene)?.name}
        </span>
        <h3>{project.name}</h3>
        <p>
          {new Date(project.updatedAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          <ArrowRight size={16} />
        </p>
      </div>
    </button>
  );
}

export default function Studio() {
  const [account, setAccount] = useState<{
    ready: boolean;
    user: User | null;
    error: boolean;
  }>({ ready: false, user: null, error: false });
  useEffect(() => {
    let active = true;
    try {
      const {
        data: { subscription },
      } = getSupabase().auth.onAuthStateChange((_event, session) => {
        if (active)
          setAccount({
            ready: true,
            user: session?.user ?? null,
            error: false,
          });
      });
      return () => {
        active = false;
        subscription.unsubscribe();
      };
    } catch {
      void Promise.resolve().then(() => {
        if (active) setAccount({ ready: true, user: null, error: true });
      });
      return () => {
        active = false;
      };
    }
  }, []);
  if (!account.ready)
    return (
      <main className="account-page">
        <p role="status">Opening your studio…</p>
      </main>
    );
  // Remount on identity changes so an earlier account's projects and photo
  // cannot remain in a later account's workspace, including across tabs.
  return (
    <StudioWorkspace
      key={account.user?.id || "guest"}
      user={account.user}
      authError={account.error}
    />
  );
}

function StudioWorkspace({
  user,
  authError,
}: {
  user: User | null;
  authError: boolean;
}) {
  const ownerId = user?.id;
  const [tab, setTab] = useState<Tab>("workspace");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("image");
  const [sceneId, setSceneId] = useState<SceneId>("studio");
  const [ratio, setRatio] = useState<Draft["ratio"]>("1:1");
  const [channel, setChannel] = useState<Draft["channel"]>("Product listing");
  const [name, setName] = useState("");
  const [facts, setFacts] = useState("");
  const [image, setImage] = useState<Blob | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [savedInput, setSavedInput] = useState<Draft | null>(null);
  const [accountProjects, setAccountProjects] = useState<ProjectSummary[]>([]);
  const [accountLoaded, setAccountLoaded] = useState(!user);
  const [accountError, setAccountError] = useState("");
  const [library, setLibrary] = useState<"account" | "device">(
    user ? "account" : "device",
  );
  const [projectSource, setProjectSource] = useState<"account" | "device">(
    "device",
  );
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadVersion = useRef(0);
  const saving = useRef(false);
  const scene = scenes.find((item) => item.id === sceneId)!;
  const unsavedChanges =
    !savedInput ||
    savedInput.image !== image ||
    savedInput.name !== name.trim() ||
    savedInput.facts !== facts.trim() ||
    savedInput.scene !== sceneId ||
    savedInput.ratio !== ratio ||
    savedInput.channel !== channel;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (ownerId) {
      listAccountProjects(ownerId)
        .then((projects) => {
          if (active) {
            setAccountProjects(projects);
            setAccountError("");
          }
        })
        .catch((error) => {
          if (active)
            setAccountError(
              error instanceof Error
                ? error.message
                : "Your account projects could not be loaded.",
            );
        })
        .finally(() => {
          if (active) setAccountLoaded(true);
        });
    }
    return () => {
      active = false;
    };
  }, [ownerId, refresh]);
  useEffect(() => {
    let active = true;
    listDrafts()
      .then((saved) => {
        if (active) setDrafts(saved);
      })
      .catch(() => {
        if (active)
          setStorageMessage(
            "Local draft storage is unavailable. You can still prepare and download a brief.",
          );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  async function acceptImage(file: File | undefined) {
    if (!file) return;
    const version = ++uploadVersion.current;
    setMessage("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage("Choose an image smaller than 8 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const usable =
        bitmap.width >= 256 &&
        bitmap.height >= 256 &&
        bitmap.width <= 6000 &&
        bitmap.height <= 6000;
      bitmap.close();
      if (!mounted.current || version !== uploadVersion.current) return;
      if (!usable) {
        setMessage("Use an image between 256 and 6,000 pixels on each side.");
        return;
      }
      setImage(file);
      setImageName(file.name);
      setImageUrl(URL.createObjectURL(file));
      setPreviewTab("image");
    } catch {
      if (version === uploadVersion.current)
        setMessage("That image could not be opened. Try a different file.");
    }
  }

  function newProject() {
    ++uploadVersion.current;
    setSavedInput(null);
    setProjectSource("device");
    setDraftId(null);
    setName("");
    setFacts("");
    setImage(null);
    setImageName("");
    setImageUrl("");
    setSceneId("studio");
    setRatio("1:1");
    setChannel("Product listing");
    setMessage("");
    setTab("workspace");
    setPreviewTab("image");
    if (fileInput.current) fileInput.current.value = "";
  }
  async function loadExample() {
    setBusy(true);
    try {
      const response = await fetch("/images/studio.jpg");
      if (!response.ok) throw new Error("Reference unavailable");
      const blob = await response.blob();
      await acceptImage(
        new File([blob], "example-amber-bottle.jpg", { type: "image/jpeg" }),
      );
      setName("Amber glass dropper bottle");
      setFacts(
        "30 ml amber glass bottle with a black dropper cap. Ingredients, benefits and certifications have not been provided.",
      );
    } catch {
      setMessage(
        "The sample photo is unavailable. Please upload your own image.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function persistProject() {
    if (!image || saving.current) return;
    if (user && !name.trim()) {
      setMessage("Add a product name before saving to your account.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setMessage("");
    const destination = user ? "account" : "device";
    const draft: Draft = {
      id:
        draftId && projectSource === destination
          ? draftId
          : crypto.randomUUID(),
      name: name.trim(),
      facts: facts.trim(),
      scene: sceneId,
      ratio,
      channel,
      image,
      imageName,
      updatedAt: Date.now(),
    };
    // Retain this identity even if a response is lost after the database commits.
    setDraftId(draft.id);
    setProjectSource(destination);
    try {
      if (user) {
        const saved = await saveAccountProject(user.id, draft);
        if (!mounted.current) return;
        setAccountProjects((current) =>
          [saved, ...current.filter((item) => item.id !== saved.id)].slice(
            0,
            100,
          ),
        );
        setLibrary("account");
        setSavedInput(draft);
        setMessage("Project and photo saved to your account.");
      } else {
        await saveDraft(draft);
        if (!mounted.current) return;
        setDrafts((current) => [
          draft,
          ...current.filter((item) => item.id !== draft.id),
        ]);
        setMessage(
          "Draft saved on this device. Sign in to save a copy to your account.",
        );
      }
      setProjectSource(destination);
      setDraftId(draft.id);
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "Your project could not be saved.",
        );
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function openCloudProject(project: ProjectSummary) {
    if (!user || saving.current) return;
    saving.current = true;
    setBusy(true);
    setMessage("");
    try {
      const draft = await openAccountProject(user.id, project.id);
      if (!mounted.current) return;
      openProject(draft, "account");
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "Your project could not be opened.",
        );
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function openProject(draft: Draft, source: "account" | "device" = "device") {
    ++uploadVersion.current;
    setProjectSource(source);
    setSavedInput(source === "account" ? draft : null);
    setDraftId(draft.id);
    setName(draft.name);
    setFacts(draft.facts);
    setSceneId(draft.scene);
    setRatio(draft.ratio);
    setChannel(draft.channel);
    setImage(draft.image);
    setImageName(draft.imageName);
    setImageUrl(URL.createObjectURL(draft.image));
    setTab("workspace");
    setPreviewTab("image");
    setMessage("");
  }
  function downloadBrief() {
    const brief = {
      product: name.trim(),
      providedFacts: facts.trim(),
      scene: scene.name,
      aspectRatio: ratio,
      channel,
      imageInstructions:
        "Preserve the product’s shape, colours, packaging and label. Use the selected scene as direction. Review all generated details before use.",
      copyInstructions:
        "Use only the provided product facts. Do not invent ingredients, claims, certifications or benefits.",
      sourceImage: imageName || null,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "shelf-studio-brief.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Your generation brief has been downloaded.");
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setTab("workspace")}
          aria-label="Shelf Studio home"
        >
          <span className="brand-icon">
            <Layers2 size={20} strokeWidth={1.5} />
          </span>
          <span>
            shelf<span className="brand-serif">studio</span>
          </span>
        </button>
        <button
          className="button secondary mobile-new-project"
          onClick={newProject}
          disabled={busy}
        >
          <Plus size={16} />
          New project
        </button>
        <div className="studio-switcher">
          <div className="workspace-avatar">
            <Layers2 size={16} aria-hidden="true" />
          </div>
          <div>
            <strong>My workspace</strong>
            <span>{user ? "Account workspace" : "Device workspace"}</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <button
          className="button new-project"
          onClick={newProject}
          disabled={busy}
        >
          <Plus size={16} /> New project
        </button>
        <p className="nav-heading">YOUR STUDIO</p>
        <nav aria-label="Studio navigation">
          <button
            className={tab === "workspace" ? "active" : ""}
            onClick={() => setTab("workspace")}
          >
            <SlidersHorizontal size={17} /> Create assets
          </button>
          <button
            className={tab === "projects" ? "active" : ""}
            onClick={() => setTab("projects")}
          >
            <FolderOpen size={17} /> Saved projects{" "}
            <span>{user ? accountProjects.length : drafts.length}</span>
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="little-star">✳</span>
          <h3>
            Small product.
            <br />
            Big possibilities.
          </h3>
          <p>
            A little direction goes a long way. Start with a clear product
            photo.
          </p>
          <button onClick={() => setShowHelp((current) => !current)}>
            A few photo tips <ArrowRight size={13} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <span /> {user ? "Account connected" : "Device drafts"}
          </div>
          <p>
            {user ? "Saved photos stay private." : "Sign in to save online."}
          </p>
          <button onClick={() => setShowHelp((current) => !current)}>
            <CircleHelp size={16} /> Studio guide
          </button>
        </div>
      </aside>

      <div className="app-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {tab === "projects" ? "Saved projects" : name || "New project"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="preview-tag">Product content studio</span>
            {tab === "workspace" && (
              <button
                className="button secondary"
                disabled={!image || busy || (!!user && !accountLoaded)}
                onClick={() => void persistProject()}
              >
                {busy ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <CheckCheck size={14} />
                )}
                {user ? "Save to account" : "Save on device"}
              </button>
            )}
            <Link href="/account" className="button secondary">
              My account
            </Link>
          </div>
        </header>
        <main id="workspace-main">
          {showHelp && (
            <section className="help-panel">
              <div>
                <strong>A good photo makes a good starting point.</strong>
                <p>
                  Use one clearly visible product, even lighting and a simple
                  background. Upload a JPG, PNG or WebP under 8 MB. Your photo
                  is uploaded privately when you choose Save to account. Device
                  drafts stay in this browser.
                </p>
              </div>
              <button
                aria-label="Close studio guide"
                onClick={() => setShowHelp(false)}
              >
                <X size={18} />
              </button>
            </section>
          )}
          {authError && (
            <p className="notice" role="status">
              Account access is unavailable. You can still save drafts on this
              device.
            </p>
          )}
          {storageMessage && (
            <p className="notice" role="status">
              {storageMessage}
            </p>
          )}
          {message && (
            <div className="workspace-message" role="status">
              <span>{message}</span>
              <button
                aria-label="Dismiss message"
                onClick={() => setMessage("")}
              >
                <X size={18} />
              </button>
            </div>
          )}

          {tab === "projects" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR WORK, ALL TOGETHER</div>
                  <h1>
                    Made room for <em>ideas.</em>
                  </h1>
                  <p>
                    Pick up where you left off. Choose your account projects or
                    drafts saved on this device.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={newProject}
                  disabled={busy}
                >
                  <Plus size={15} />
                  New project
                </button>
              </div>
              <div className="library-toolbar">
                <div className="library-tabs">
                  <button
                    aria-pressed={library === "account"}
                    onClick={() => setLibrary("account")}
                    disabled={busy}
                  >
                    Account projects
                  </button>
                  <button
                    aria-pressed={library === "device"}
                    onClick={() => setLibrary("device")}
                    disabled={busy}
                  >
                    Device drafts
                  </button>
                </div>
                {library === "account" && user && (
                  <button
                    className="button secondary"
                    disabled={busy || !accountLoaded}
                    onClick={() => {
                      setAccountLoaded(false);
                      setRefresh((current) => current + 1);
                    }}
                  >
                    Refresh projects
                  </button>
                )}
              </div>
              {library === "account" ? (
                !user ? (
                  <section className="empty-projects">
                    <FolderOpen size={32} />
                    <h2>Your projects, wherever you work.</h2>
                    <p>
                      Sign in to save product photos and project details to your
                      account.
                    </p>
                    <Link className="button primary" href="/account">
                      Sign in
                      <ArrowRight size={15} />
                    </Link>
                  </section>
                ) : !accountLoaded ? (
                  <p className="notice" role="status">
                    Loading your account projects…
                  </p>
                ) : accountError ? (
                  <p className="notice" role="alert">
                    {accountError} Use Refresh projects to try again.
                  </p>
                ) : accountProjects.length ? (
                  <>
                    <p className="library-description">
                      Your 100 most recently updated account projects. Open a
                      project to edit it; save again to update it.
                    </p>
                    <div className="projects-grid">
                      {accountProjects.map((project) => (
                        <AccountProjectCard
                          key={project.id}
                          project={project}
                          disabled={busy}
                          onOpen={() => void openCloudProject(project)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <section className="empty-projects">
                    <FolderOpen size={32} />
                    <h2>Your next idea belongs here.</h2>
                    <p>
                      Upload a photo, add a product name, then choose Save to
                      account.
                    </p>
                    <button
                      className="button primary"
                      onClick={newProject}
                      disabled={busy}
                    >
                      Create a project
                      <ArrowRight size={15} />
                    </button>
                  </section>
                )
              ) : !loaded ? (
                <p className="notice" role="status">
                  Loading device drafts…
                </p>
              ) : drafts.length ? (
                <>
                  <p className="library-description">
                    These drafts belong to this browser, not an account. Open
                    one and choose Save to account to upload a copy.
                  </p>
                  <div className="projects-grid">
                    {drafts.map((draft) => (
                      <DraftCard
                        key={draft.id}
                        draft={draft}
                        onOpen={() => {
                          if (!busy) openProject(draft);
                        }}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <section className="empty-projects">
                  <FolderOpen size={32} />
                  <h2>No device drafts yet.</h2>
                  <p>
                    Device drafts are saved locally when you work without
                    signing in.
                  </p>
                  <button
                    className="button primary"
                    onClick={newProject}
                    disabled={busy}
                  >
                    Create a project
                    <ArrowRight size={15} />
                  </button>
                </section>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span /> A LITTLE CREATIVE DIRECTION
                  </div>
                  <h1>
                    Your product. <em>A fresh perspective.</em>
                  </h1>
                  <p>
                    Bring the photo. Set the scene. Give your next product story
                    a place to start.
                  </p>
                </div>
                <span className="workspace-label">
                  <span /> Product workspace
                </span>
              </div>
              <div className="workspace-grid">
                <fieldset
                  className="brief-panel"
                  aria-label="Product setup"
                  disabled={busy}
                >
                  <div className="panel-heading">
                    <div>
                      <h2>Let’s set the scene.</h2>
                      <p>Start with the essentials.</p>
                    </div>
                    <SlidersHorizontal size={17} />
                  </div>
                  <div className="input-section">
                    <div className="section-label">
                      <label htmlFor="product-photo">Product photo</label>
                      <span>Required</span>
                    </div>
                    <label
                      className={
                        "upload-area " +
                        (dragging ? "dragging" : "") +
                        (image ? " has-image" : "")
                      }
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        if (busy) return;
                        if (event.dataTransfer.files.length !== 1) {
                          setMessage("Drop one product photo at a time.");
                          return;
                        }
                        void acceptImage(event.dataTransfer.files[0]);
                      }}
                    >
                      <input
                        ref={fileInput}
                        id="product-photo"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(event) => {
                          void acceptImage(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                      {imageUrl ? (
                        <>
                          <span className="uploaded-thumbnail">
                            <Image
                              src={imageUrl}
                              alt="Uploaded product"
                              fill
                              unoptimized
                              sizes="70px"
                            />
                          </span>
                          <strong>{imageName}</strong>
                          <span>Click to replace your photo</span>
                        </>
                      ) : (
                        <>
                          <span className="upload-icon">
                            <Upload size={20} strokeWidth={1.5} />
                          </span>
                          <strong>Drop your product photo here</strong>
                          <span>
                            or <b>browse files</b>
                          </span>
                          <small>JPG, PNG, WebP · Up to 8 MB</small>
                        </>
                      )}
                    </label>
                    {!image && (
                      <button
                        className="sample-link"
                        disabled={busy}
                        onClick={() => void loadExample()}
                      >
                        Just exploring? Try a sample product{" "}
                        <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                  <div className="input-section">
                    <label htmlFor="product-name">Product name</label>
                    <input
                      id="product-name"
                      placeholder="e.g. Amber glass dropper bottle"
                      maxLength={100}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <label htmlFor="product-facts">A few product details</label>
                    <textarea
                      id="product-facts"
                      placeholder="Size, materials, ingredients or features you can verify…"
                      rows={3}
                      maxLength={1500}
                      value={facts}
                      onChange={(event) => setFacts(event.target.value)}
                    />
                    <p className="field-help">
                      Your facts will guide the copy. Add only details you know
                      are true.
                    </p>
                  </div>
                  <fieldset className="scene-fieldset">
                    <legend>Choose a scene</legend>
                    <div className="scene-options">
                      {scenes.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={sceneId === item.id}
                          className={sceneId === item.id ? "selected" : ""}
                          onClick={() => setSceneId(item.id)}
                        >
                          <span className="scene-thumb">
                            <Image src={item.image} alt="" fill sizes="56px" />
                          </span>
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.description}</small>
                          </span>
                          <span className="scene-radio">
                            {sceneId === item.id && <Check size={10} />}
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="format-controls">
                    <fieldset>
                      <legend>Image format</legend>
                      <div className="ratio-options">
                        {ratios.map((value) => (
                          <button
                            key={value}
                            aria-pressed={ratio === value}
                            onClick={() => setRatio(value)}
                          >
                            <span
                              className={
                                "ratio-icon ratio-" + value.replace(":", "-")
                              }
                            />
                            {value}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <label htmlFor="content-channel">Content for</label>
                    <select
                      id="content-channel"
                      value={channel}
                      onChange={(event) =>
                        setChannel(event.target.value as Draft["channel"])
                      }
                    >
                      <option>Product listing</option>
                      <option>Instagram</option>
                      <option>Website</option>
                    </select>
                  </div>
                </fieldset>

                <div className="output-column">
                  <section
                    className="preview-panel"
                    aria-label="Product workspace preview"
                  >
                    <div className="preview-toolbar">
                      <div className="preview-tabs">
                        <button
                          aria-pressed={previewTab === "image"}
                          onClick={() => setPreviewTab("image")}
                        >
                          <ImagePlus size={15} />
                          Image workspace
                        </button>
                        <button
                          aria-pressed={previewTab === "brief"}
                          onClick={() => setPreviewTab("brief")}
                        >
                          <FileText size={15} />
                          Content brief
                        </button>
                      </div>
                      <span>{ratio}</span>
                    </div>
                    {previewTab === "image" ? (
                      <div className={"visual-stage scene-" + sceneId}>
                        <div className="preview-context">
                          <span>
                            {image ? "YOUR ORIGINAL PHOTO" : "SCENE REFERENCE"}
                          </span>
                          <span>
                            <scene.icon size={12} />
                            {scene.name}
                          </span>
                        </div>
                        <div
                          className={
                            "product-frame " + (image ? "source-frame" : "")
                          }
                          style={
                            image
                              ? { aspectRatio: ratio.replace(":", " / ") }
                              : undefined
                          }
                        >
                          <Image
                            src={imageUrl || scene.image}
                            alt={
                              image
                                ? "Your uploaded product, before AI editing"
                                : "Reference product photograph for scene inspiration"
                            }
                            fill
                            unoptimized={!!imageUrl}
                            sizes="(max-width: 800px) 90vw, 55vw"
                            className={
                              image ? "source-image" : "reference-image"
                            }
                            loading="eager"
                          />
                          {!image && (
                            <div className="reference-overlay">
                              <span>
                                A little light.
                                <br />
                                <em>A different story.</em>
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="preview-caption">
                          <span>
                            {image
                              ? "Original upload · Ready for creative direction"
                              : "Reference photography · Not generated output"}
                          </span>
                          <span className="preview-spark">
                            <Sparkles size={14} />
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="brief-preview">
                        <span className="eyebrow">YOUR GENERATION BRIEF</span>
                        <h2>
                          {name.trim() || "Your product story starts here."}
                        </h2>
                        <dl>
                          <div>
                            <dt>Product facts</dt>
                            <dd>
                              {facts.trim() ||
                                "Add a few verified details in the product setup."}
                            </dd>
                          </div>
                          <div>
                            <dt>Scene direction</dt>
                            <dd>
                              {scene.name} · {scene.description}
                            </dd>
                          </div>
                          <div>
                            <dt>Format & destination</dt>
                            <dd>
                              {ratio} · {channel}
                            </dd>
                          </div>
                        </dl>
                        <p>
                          Generated copy will use your product facts.
                          Ingredients, benefits and certifications must be
                          supplied by you.
                        </p>
                        <button
                          className="button secondary"
                          onClick={downloadBrief}
                          disabled={!name.trim() || !facts.trim()}
                        >
                          <ArrowDownToLine size={14} />
                          Download brief
                        </button>
                      </div>
                    )}
                  </section>
                  <GenerationPanel
                    key={draftId || "new"}
                    userId={ownerId}
                    projectId={projectSource === "account" ? draftId : null}
                    dirty={unsavedChanges}
                    workspaceBusy={busy}
                  />
                </div>
              </div>
              <footer className="studio-footer">
                <span>A thoughtful starting point for small brands.</span>
                <button onClick={() => setShowHelp((current) => !current)}>
                  Photo tips & studio guide <ArrowRight size={12} />
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
