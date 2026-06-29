// Package storage defines the file-storage provider boundary. Business modules
// depend only on this interface so the backing store can start as Supabase
// private buckets and later move to MinIO/S3 without code changes.
//
// Files are never served via permanent public URLs. The API issues short-lived
// signed URLs only after it has verified the caller's permission for the
// owning record.
package storage

import (
	"context"
	"time"
)

// Object identifies a stored file by bucket and key.
type Object struct {
	Bucket string
	Key    string
}

// UploadRequest describes a validated upload (size/MIME checked by the caller).
type UploadRequest struct {
	Object      Object
	ContentType string
	Size        int64
}

// Provider abstracts a private object store.
type Provider interface {
	// SignedUploadURL returns a short-lived URL the client may use to upload
	// directly, after the API has authorized the operation.
	SignedUploadURL(ctx context.Context, req UploadRequest, ttl time.Duration) (string, error)
	// SignedDownloadURL returns a short-lived read URL after authorization.
	SignedDownloadURL(ctx context.Context, obj Object, ttl time.Duration) (string, error)
	// Delete removes an object.
	Delete(ctx context.Context, obj Object) error
}

// DefaultDownloadTTL / DefaultUploadTTL keep signed URLs short-lived.
const (
	DefaultDownloadTTL = 5 * time.Minute
	DefaultUploadTTL   = 10 * time.Minute
)
