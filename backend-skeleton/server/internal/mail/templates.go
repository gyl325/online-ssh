package mail

import (
	"bytes"
	"embed"
	"html/template"
)

//go:embed templates/*.html
var templateFS embed.FS

type VerificationCodeTemplateData struct {
	Brand      string
	Code       string
	Footer     string
	Heading    string
	Title      string
	TTLMinutes int
}

func RenderVerificationCodeHTML(data VerificationCodeTemplateData) (string, error) {
	tmpl, err := template.ParseFS(templateFS, "templates/verification-code.html")
	if err != nil {
		return "", err
	}

	var buffer bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buffer, "verification-code.html", data); err != nil {
		return "", err
	}
	return buffer.String(), nil
}
