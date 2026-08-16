import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Eye,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { ImageLightbox } from "@/components/ImageLightbox"
import { VendorStudioNav } from "@/components/VendorStudioNav"
import { AppSelect } from "@/components/ui/AppSelect"
import { api } from "@/lib/api"
import { boundedNumber } from "@/lib/formLimits"
import type { Design, DesignImage, DesignInput, DesignStatus, VendorSummary } from "@/types/api"

const emptyForm: DesignInput = {
  title: "",
  description: "",
  category: "women",
  garment_type: "",
  base_price: 0,
}

const MAX_IMAGES_PER_DESIGN = 10
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const statusLabels: Record<DesignStatus, string> = {
  draft: "Draft",
  submitted: "Under review",
  approved: "Published",
  rejected: "Needs changes",
}
const DESIGN_STATUS_OPTIONS = [{ value: "all", label: "All statuses" }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]
const DESIGN_CATEGORY_OPTIONS = [{ value: "women", label: "Women" }, { value: "men", label: "Men" }, { value: "unisex", label: "Unisex" }, { value: "kids", label: "Kids" }]

const VendorWorkspace = () => {
  const [designs, setDesigns] = useState<Design[]>([])
  const [summary, setSummary] = useState<VendorSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Design | null>(null)
  const [form, setForm] = useState<DesignInput>(emptyForm)
  const [formImages, setFormImages] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | DesignStatus>("all")
  const [lightbox, setLightbox] = useState<{ images: DesignImage[]; index: number } | null>(null)

  const loadWorkspace = useCallback(async () => {
    try {
      const [items, totals] = await Promise.all([
        api<Design[]>("/api/vendor/designs"),
        api<VendorSummary>("/api/vendor/summary"),
      ])
      setDesigns(items)
      setSummary(totals)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const visibleDesigns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return designs.filter((design) => {
      const matchesStatus = statusFilter === "all" || design.status === statusFilter
      const matchesSearch = !normalizedSearch || [
        design.title,
        design.description,
        design.garment_type,
        design.category,
      ].some((value) => value.toLowerCase().includes(normalizedSearch))
      return matchesStatus && matchesSearch
    })
  }, [designs, search, statusFilter])

  const formImagePreviews = useMemo(
    () => formImages.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [formImages],
  )

  useEffect(() => () => {
    formImagePreviews.forEach(({ url }) => URL.revokeObjectURL(url))
  }, [formImagePreviews])

  const openLightbox = (design: Design, imageId: number) => {
    const images = design.images.filter((image) => image.url)
    const index = Math.max(0, images.findIndex((image) => image.id === imageId))
    setLightbox({ images, index })
  }

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormImages([])
    setFormOpen(true)
  }

  const openEdit = (design: Design) => {
    setEditing(design)
    setFormImages([])
    setForm({
      title: design.title,
      description: design.description,
      category: design.category,
      garment_type: design.garment_type,
      base_price: design.base_price,
    })
    setFormOpen(true)
  }

  const closeForm = () => {
    if (saving) return
    setFormImages([])
    setFormOpen(false)
  }

  const chooseFormImages = (files: FileList | null) => {
    if (!files?.length) return
    const selected = Array.from(files)
    const existingCount = editing?.images.length ?? 0
    if (existingCount + formImages.length + selected.length > MAX_IMAGES_PER_DESIGN) {
      toast.error(`Each design can have up to ${MAX_IMAGES_PER_DESIGN} images`)
      return
    }
    const invalid = selected.find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
        || file.size <= 0
        || file.size > MAX_IMAGE_BYTES,
    )
    if (invalid) {
      toast.error("Use JPEG, PNG, or WebP files up to 2 MB each")
      return
    }
    setFormImages((current) => [...current, ...selected])
  }

  const saveDesign = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    let savedDesign: Design | null = null
    let uploadedCount = 0
    try {
      savedDesign = await api<Design>(editing ? `/api/vendor/designs/${editing.id}` : "/api/vendor/designs", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ ...form, base_price: Number(form.base_price) }),
      })

      for (const file of formImages) {
        const imageData = new FormData()
        imageData.append("file", file)
        imageData.append("sort_order", String(savedDesign.images.length))
        savedDesign = await api<Design>(`/api/vendor/designs/${savedDesign.id}/images`, {
          method: "POST",
          body: imageData,
        })
        uploadedCount += 1
      }

      toast.success(
        editing?.status === "approved"
          ? "Published design moved to draft. Submit it again after your changes."
          : formImages.length
            ? `Draft saved with ${formImages.length} image${formImages.length > 1 ? "s" : ""}`
            : editing ? "Draft updated" : "Draft created",
      )
      setFormImages([])
      setFormOpen(false)
      await loadWorkspace()
    } catch (error) {
      if (savedDesign) {
        setEditing(savedDesign)
        setFormImages((current) => current.slice(uploadedCount))
        toast.error(`Draft saved, but an image could not upload: ${(error as Error).message}. Retry from this form.`)
        await loadWorkspace()
      } else {
        toast.error((error as Error).message)
      }
    } finally {
      setSaving(false)
    }
  }

  const uploadImages = async (design: Design, files: FileList | null) => {
    if (!files?.length) return
    if (design.images.length + files.length > MAX_IMAGES_PER_DESIGN) {
      toast.error(`Each design can have up to ${MAX_IMAGES_PER_DESIGN} images`)
      return
    }
    const selected = Array.from(files)
    const invalid = selected.find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
        || file.size <= 0
        || file.size > MAX_IMAGE_BYTES,
    )
    if (invalid) {
      toast.error("Use JPEG, PNG, or WebP files up to 2 MB each")
      return
    }

    setBusyId(design.id)
    try {
      for (const [index, file] of selected.entries()) {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("sort_order", String(design.images.length + index))
        await api(`/api/vendor/designs/${design.id}/images`, {
          method: "POST",
          body: formData,
        })
      }
      toast.success(
        design.status === "approved"
          ? "Images added and the published design moved to draft for reapproval."
          : `${selected.length} image${selected.length > 1 ? "s" : ""} uploaded`,
      )
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
      await loadWorkspace()
    }
  }

  const deleteImage = async (design: Design, imageId: number) => {
    if (design.status === "approved" && !window.confirm(
      "Removing this image will unpublish the design and move it to draft. Continue?",
    )) return
    setBusyId(design.id)
    try {
      await api(`/api/vendor/designs/${design.id}/images/${imageId}`, {
        method: "DELETE",
      })
      toast.success(
        design.status === "approved"
          ? "Image removed. The design is now a draft and must be approved again."
          : "Image deleted",
      )
      await loadWorkspace()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const submitDesign = async (design: Design) => {
    setBusyId(design.id)
    try {
      await api(`/api/vendor/designs/${design.id}/submit`, { method: "POST" })
      toast.success("Design submitted for review")
      await loadWorkspace()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const deleteDesign = async (design: Design) => {
    if (!window.confirm(`Delete "${design.title}" and all of its uploaded images?`)) return
    setBusyId(design.id)
    try {
      await api(`/api/vendor/designs/${design.id}`, { method: "DELETE" })
      toast.success("Design and bucket images deleted")
      await loadWorkspace()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page workspace-page">
      <VendorStudioNav />
      <section className="workspace-heading">
        <div>
          <p className="eyebrow"><Sparkles size={15} /> Vendor workspace</p>
          <h1>Manage your collection</h1>
          <p>Create a design, add 1–10 images, then send it to Vastrivo for approval.</p>
        </div>
        <div className="workspace-heading-actions"><button className="button button-primary" onClick={openCreate} type="button"><Plus size={18} /> New design</button></div>
      </section>

      {summary && (
        <section className="summary-grid" aria-label="Design status summary">
          {(["draft", "submitted", "approved", "rejected"] as const).map((key) => (
            <article className="summary-card" key={key}>
              <span>{statusLabels[key]}</span>
              <strong>{summary[key]}</strong>
            </article>
          ))}
        </section>
      )}

      {designs.length > 0 && (
        <section className="vendor-workspace-toolbar" aria-label="Filter your designs">
          <label className="search-field">
            <Search size={18} />
            <span className="sr-only">Search your designs</span>
            <input onChange={(event) => setSearch(event.target.value)} placeholder="Search title, garment, category…" value={search} />
          </label>
          <AppSelect ariaLabel="Filter designs by status" className="toolbar-select" onValueChange={(value) => setStatusFilter(value as "all" | DesignStatus)} options={DESIGN_STATUS_OPTIONS} value={statusFilter} />
          <span>{visibleDesigns.length} of {designs.length} designs</span>
        </section>
      )}

      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" /> Loading workspace…</div>
      ) : designs.length === 0 ? (
        <section className="empty-state workspace-empty">
          <ImagePlus size={48} strokeWidth={1.4} />
          <h2>Your collection starts here</h2>
          <p>Create your first draft and add clear front, back, and detail photographs.</p>
          <button className="button" onClick={openCreate} type="button">Create a draft</button>
        </section>
      ) : visibleDesigns.length === 0 ? (
        <section className="empty-state vendor-filter-empty">
          <Search size={38} strokeWidth={1.5} />
          <h2>No matching designs</h2>
          <p>Try another search or status filter.</p>
          <button className="button button-quiet" onClick={() => { setSearch(""); setStatusFilter("all") }} type="button">Clear filters</button>
        </section>
      ) : (
        <section className="workspace-list">
          {visibleDesigns.map((design) => {
            const editable = design.status === "draft" || design.status === "rejected" || design.status === "approved"
            const submittable = design.status === "draft" || design.status === "rejected"
            const readyImages = design.images.filter((image) => image.upload_status === "ready")
            return (
              <article className="workspace-card" key={design.id}>
                <div className="workspace-card-copy">
                  <div className="workspace-card-title">
                    <div>
                      <span className={`status-badge status-${design.status}`}>{statusLabels[design.status]}</span>
                      <h2>{design.title}</h2>
                    </div>
                    <strong>Tailoring ₹{design.base_price.toLocaleString("en-IN")}</strong>
                  </div>
                  <p>{design.description}</p>
                  <div className="design-meta">
                    <span>{design.category}</span>
                    <span>{design.garment_type}</span>
                    <span>{readyImages.length}/10 images</span>
                  </div>
                  {design.rejection_comment && (
                    <div className="review-note">
                      <strong>Reviewer note</strong>
                      <p>{design.rejection_comment}</p>
                    </div>
                  )}
                  {design.status === "approved" && (
                    <div className="published-revision-note">
                      <strong>Published</strong>
                      <span>Customers can see this design. Any detail or image change will move it to draft for approval again.</span>
                    </div>
                  )}
                  {design.status === "submitted" && (
                    <div className="submitted-lock-note">
                      <strong>Review in progress</strong>
                      <span>You can preview the gallery, but editing is locked until the review is complete.</span>
                    </div>
                  )}
                </div>

                <div className="design-media-heading">
                  <div><strong>Design photos</strong><small>Click any image for a full-size preview.</small></div>
                  <span>{readyImages.length} / 10</span>
                </div>
                <div className="design-image-strip">
                  {design.images.map((image) => (
                    <div className="design-thumbnail" key={image.id}>
                      {image.url
                        ? (
                          <button className="thumbnail-preview" aria-label={`Preview ${image.original_filename}`} onClick={() => openLightbox(design, image.id)} type="button">
                            <ApiImage alt={image.original_filename} src={image.url} />
                            <span><Eye size={15} /> Preview</span>
                          </button>
                        )
                        : <span>{image.upload_status}</span>}
                      {editable && (
                        <button
                          aria-label={`Delete ${image.original_filename}`}
                          className="thumbnail-delete"
                          disabled={busyId === design.id}
                          onClick={() => deleteImage(design, image.id)}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {editable && design.images.length < 10 && (
                    <label className="upload-tile">
                      <ImagePlus size={21} />
                      <span>Add images</span>
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busyId === design.id}
                        multiple
                        onChange={(event) => {
                          void uploadImages(design, event.target.files)
                          event.currentTarget.value = ""
                        }}
                        type="file"
                      />
                    </label>
                  )}
                </div>

                <div className="workspace-card-actions">
                  {editable && (
                    <button className="button button-quiet" onClick={() => openEdit(design)} type="button">
                      <Pencil size={16} /> {design.status === "approved" ? "Edit published design" : "Edit details"}
                    </button>
                  )}
                  {submittable && (
                      <button
                        className="button button-primary"
                        disabled={busyId === design.id || readyImages.length < 1}
                        onClick={() => submitDesign(design)}
                        type="button"
                      >
                        {busyId === design.id ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                        Submit for review
                      </button>
                  )}
                  <button className="button button-quiet danger" disabled={busyId === design.id} onClick={() => deleteDesign(design)} type="button">
                    <Trash2 size={16} /> Delete
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {lightbox && (
        <ImageLightbox
          images={lightbox.images.flatMap((image) => image.url ? [{
            id: image.id,
            src: image.url,
            alt: image.original_filename,
            label: image.original_filename,
          }] : [])}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {formOpen && (
        <Dialog
          description={editing?.status === "approved"
            ? "Saving changes will remove this design from the live collection and create a draft that must be approved again."
            : "Add the details and photos together. We create the private draft before uploading its images."}
          onClose={closeForm}
          title={editing ? "Edit design" : "Create a design"}
        >
          <form className="dialog-form form-stack" onSubmit={saveDesign}>
            <div className="field">
              <label htmlFor="design-title">Title</label>
              <input id="design-title" maxLength={150} required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="design-description">Description</label>
              <textarea id="design-description" maxLength={3000} minLength={10} required rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="design-category">Category</label>
                <AppSelect id="design-category" onValueChange={(value) => setForm({ ...form, category: value as DesignInput["category"] })} options={DESIGN_CATEGORY_OPTIONS} value={form.category} />
              </div>
              <div className="field">
                <label htmlFor="garment-type">Garment type</label>
                <input id="garment-type" maxLength={50} placeholder="Kurta, blouse, suit…" required value={form.garment_type} onChange={(event) => setForm({ ...form, garment_type: event.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="base-price">Tailoring service price (₹)</label>
              <input id="base-price" max={1_000_000} min={1} required type="number" value={form.base_price || ""} onChange={(event) => setForm({ ...form, base_price: boundedNumber(event.target.value, 0, 1_000_000) })} />
            </div>
            <section className="design-form-media">
              <div className="design-form-media-heading">
                <div>
                  <strong>Design photos</strong>
                  <span>Add up to 10 clear views. The first photo is used as the cover.</span>
                </div>
                <span>{(editing?.images.length ?? 0) + formImages.length}/{MAX_IMAGES_PER_DESIGN}</span>
              </div>

              {formImagePreviews.length > 0 && (
                <div className="design-form-previews" aria-label="Selected design photos">
                  {formImagePreviews.map(({ file, url }, index) => (
                    <div className="design-form-preview" key={`${file.name}-${file.lastModified}-${index}`}>
                      <img alt={`Selected design ${index + 1}`} src={url} />
                      <button
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setFormImages((current) => current.filter((_, imageIndex) => imageIndex !== index))}
                        type="button"
                      >
                        <X size={15} />
                      </button>
                      <span>{(editing?.images.length ?? 0) === 0 && index === 0 ? "Cover" : "New"}</span>
                    </div>
                  ))}
                </div>
              )}

              <label className="design-form-image-picker">
                <span className="design-form-image-picker-icon"><ImagePlus size={22} /></span>
                <span>
                  <strong>{formImages.length ? "Add more photos" : "Choose design photos"}</strong>
                  <small>JPEG, PNG or WebP · maximum 2 MB each</small>
                </span>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={(editing?.images.length ?? 0) + formImages.length >= MAX_IMAGES_PER_DESIGN || saving}
                  multiple
                  onChange={(event) => {
                    chooseFormImages(event.target.files)
                    event.target.value = ""
                  }}
                  type="file"
                />
              </label>
              {!!editing?.images.length && (
                <p className="design-form-existing-note">
                  This design already has {editing.images.length} photo{editing.images.length > 1 ? "s" : ""}. You can manage them from its design card.
                </p>
              )}
            </section>
            <div className="dialog-actions">
              <button className="button button-quiet" disabled={saving} onClick={closeForm} type="button">Cancel</button>
              <button className="button button-primary" disabled={saving} type="submit">
                {saving ? <><LoaderCircle className="spin" size={17} /> Saving &amp; uploading…</> : formImages.length ? "Save draft & upload" : "Save draft"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  )
}

export default VendorWorkspace
