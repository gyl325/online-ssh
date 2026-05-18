package auth

import "context"

type contextKey string

const sessionContextKey contextKey = "auth.session"

func WithSession(ctx context.Context, session AuthenticatedSession) context.Context {
	return context.WithValue(ctx, sessionContextKey, session)
}

func SessionFromContext(ctx context.Context) (AuthenticatedSession, bool) {
	session, ok := ctx.Value(sessionContextKey).(AuthenticatedSession)
	return session, ok
}
