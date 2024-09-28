import sys
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QLineEdit, QPushButton, QLabel, QMessageBox
)

class AuthApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Кафе - Вход и Регистрация")
        self.setGeometry(100, 100, 300, 200)

        self.central_widget = QWidget()
        self.setCentralWidget(self.central_widget)

        self.layout = QVBoxLayout(self.central_widget)

        self.label = QLabel("Выберите действие:")
        self.layout.addWidget(self.label)

        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Имя пользователя")
        self.layout.addWidget(self.username_input)

        self.password_input = QLineEdit()
        self.password_input.setPlaceholderText("Пароль")
        self.password_input.setEchoMode(QLineEdit.Password)
        self.layout.addWidget(self.password_input)

        self.login_button = QPushButton("Войти")
        self.login_button.clicked.connect(self.login)
        self.layout.addWidget(self.login_button)

        self.register_button = QPushButton("Регистрация")
        self.register_button.clicked.connect(self.register)
        self.layout.addWidget(self.register_button)

        self.users = {}  # Словарь для хранения пользователей

    def login(self):
        username = self.username_input.text()
        password = self.password_input.text()

        if username in self.users and self.users[username] == password:
            QMessageBox.information(self, "Успех", "Вы успешно вошли!")
        else:
            QMessageBox.warning(self, "Ошибка", "Неверное имя пользователя или пароль.")

    def register(self):
        username = self.username_input.text()
        password = self.password_input.text()

        if username in self.users:
            QMessageBox.warning(self, "Ошибка", "Пользователь уже существует.")
        else:
            self.users[username] = password
            QMessageBox.information(self, "Успех", "Регистрация прошла успешно!")

if name == "__main__":
    app = QApplication(sys.argv)
    window = AuthApp()
    window.show()
    sys.exit(app.exec())
echo "# holont" >> README.md 
git init 
git add README.md 
git commit -m "первый коммит" 
git branch -M main 
git remote add origin https://github.com/ho1ont/holont.git
 git push -u origin main\